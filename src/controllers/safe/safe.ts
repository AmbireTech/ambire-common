import { getAddress } from 'ethers'

import { FETCH_OTHER_SAFES_PENDING, FETCH_SAFE_TXNS } from '../../consts/intervals'
import {
  NOT_A_SAFE_ACCOUNT_MESSAGE,
  SAFE_API_BATCH_SIZE,
  SAFE_API_TIMEOUT_MS,
  SAFE_INFO_FETCH_FAILED_MESSAGE,
  SAFE_NETWORKS,
  safeNullOwner
} from '../../consts/safe'
import { IAccountsController, SafeAccountCreation } from '../../interfaces/account'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { Hex } from '../../interfaces/hex'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController, RPCProvider } from '../../interfaces/provider'
import { ISafeController, SafeAccountByOwner } from '../../interfaces/safe'
import { IStorageController } from '../../interfaces/storage'
import {
  ExtendedSafeMessage,
  fetchAllPending,
  fetchExecutedTransactions,
  findDeployData,
  getApiKit,
  getMessage,
  getSafeAccountByOwner,
  getVerifiedSafeConfirmations,
  isSafeContract,
  isSafeMessageHashValid,
  isSafeTxHashValid,
  SafeFetchedTransaction,
  SafePendingFetchNetwork,
  SafeResults,
  sortSigs
} from '../../libs/safe/safe'
import wait from '../../utils/wait'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'
import { onFeatureFlagChange } from '../featureFlags/onFeatureFlagChange'

import type { SafeInfoResponse, SafeMessage } from '@safe-global/api-kit'

const SAFE_OWNER_SEARCH_TTL = 5 * 60 * 1000
const SAFE_OWNER_SEARCH_DEBOUNCE = 3 * 1000
/** The pause between two requests for pending Safe txns, to stay under the Safe API's rate limit */
const SAFE_PENDING_REQUEST_PAUSE = 600

export const STATUS_WRAPPED_METHODS = {
  findSafe: 'INITIAL'
} as const

type SafeOwnerSearch = {
  owner: Hex
  accounts: SafeAccountByOwner[]
  searchedNetworks: bigint[]
  failedNetworks: bigint[]
  updatedAt: number
  status: 'LOADING' | 'DONE'
}

export class SafeController extends EventEmitter implements ISafeController {
  #storage: IStorageController

  #networks: INetworksController

  #accounts: IAccountsController

  #keystore: IKeystoreController

  #providers: IProvidersController

  #featureFlags: IFeatureFlagsController

  /**
   * The last time a request to fetch pending Safe txns was made, per Safe
   */
  #pendingFetchedAt: Record<string, number> = {}

  #updateOtherSafesPendingCountsPromise?: Promise<void>

  #rejectedSafeTxns: string[] = []

  initialLoadPromise?: Promise<void>

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  importError?: {
    message: string
    address: string
  }

  safeInfo?: SafeAccountCreation & {
    deployedOn: bigint[]
    address: Hex
    owners: Hex[]
    // does the safe need special conditions to send/sign txns
    requiresModules: boolean
  }

  ownerCurrentlyDisplayingFor?: Hex
  safeOwnerSearches: Record<Hex, SafeOwnerSearch> = {}

  /**
   * How many txns and messages wait for more owners' signatures, per Safe and chain id. Kept
   * for all of the user's Safes, so the ones that are not selected have a pending count
   * without a signing request being built for each of their txns.
   */
  pendingCountBySafe: Record<string, Record<string, number>> = {}

  constructor({
    eventEmitterRegistry,
    networks,
    providers,
    storage,
    accounts,
    keystore,
    featureFlags
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    networks: INetworksController
    providers: IProvidersController
    storage: IStorageController
    accounts: IAccountsController
    keystore: IKeystoreController
    featureFlags: IFeatureFlagsController
  }) {
    super(eventEmitterRegistry)
    this.#networks = networks
    this.#providers = providers
    this.#storage = storage
    this.#accounts = accounts
    this.#keystore = keystore
    this.#featureFlags = featureFlags
    // Opted out of the Safe API: the counts would never refresh again, so drop them
    onFeatureFlagChange(featureFlags, 'safeApi', (isEnabled) => {
      if (isEnabled) return
      this.pendingCountBySafe = {}
      this.#pendingFetchedAt = {}
      this.emitUpdate()
    })
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  /**
   * Await `#featureFlags.initialLoadPromise` before reading it, as until the flags are loaded
   * from storage it's the default (on), even for a user who opted out
   */
  get #isSafeApiEnabled() {
    return this.#featureFlags.isFeatureEnabled('safeApi')
  }

  /** Background Safe API requests are made only while unlocked and not opted out */
  get #canSyncWithSafeApi() {
    return this.#keystore.isUnlocked && this.#isSafeApiEnabled
  }

  async #load() {
    await this.#accounts.initialLoadPromise
    this.#rejectedSafeTxns = await this.#storage.get('rejectedSafeTxns', [])
  }

  /**
   * Check if the passed safeAddr is deployed on any chain that:
   * - the user has enabled in the extension +
   * - Safe contracts are deployed on and are in our config, SAFE_NETWORKS
   * If deployed, get its config and check if we support it.
   * If we do, allow import of that safe
   */
  async #findSafe(safeAddr: string) {
    this.importError = undefined
    this.safeInfo = undefined
    await this.#featureFlags.initialLoadPromise
    // The UI asks the user to turn the Safe API back on before searching
    if (!this.#isSafeApiEnabled) return

    // search enabled networks that are Safe supported
    const safeNetworks = this.#networks.networks.filter(
      (n) =>
        SAFE_NETWORKS.includes(Number(n.chainId)) &&
        !!this.#providers.providers[n.chainId.toString()] // just in case
    )
    // check where the account is deployed
    const codes = await Promise.all(
      safeNetworks.map((n) =>
        this.#providers.providers[n.chainId.toString()]!.getCode(safeAddr)
          .then((code) => ({ chainId: n.chainId, code }))
          .catch(() => ({ chainId: n.chainId, code: '0x' }))
      )
    )
    const deployedOn = codes.find((c) => c.code && c.code !== '0x')
    if (!deployedOn) {
      this.importError = {
        address: safeAddr,
        message: `The Safe account isn't active on any of your enabled networks that support Safe: ${safeNetworks.map((n) => n.name).join(', ')}. Please activate it in the Safe app on at least one of them before continuing.`
      }
      return
    }

    const apiKit = getApiKit(deployedOn.chainId)
    const provider = this.#providers.providers[deployedOn.chainId.toString()]!
    const [safeInfo, safeCreation]: [SafeInfoResponse | Error, SafeAccountCreation | Error] =
      await Promise.all([
        withTimeout(() => apiKit.getSafeInfo(safeAddr), {
          timeoutMs: SAFE_API_TIMEOUT_MS,
          message: `Safe API: get Safe info timed out after ${SAFE_API_TIMEOUT_MS}ms`
        }).catch((e) => e),
        findDeployData(safeAddr, deployedOn.chainId, provider)
      ])
    if (safeInfo instanceof Error) {
      this.importError = {
        address: safeAddr,
        message: await this.#getSafeInfoFailedMessage(safeAddr, provider, safeInfo)
      }
      return
    }
    if (safeCreation instanceof Error) {
      this.importError = {
        address: safeAddr,
        message: safeCreation.message
      }
      return
    }

    this.safeInfo = {
      ...safeCreation,
      address: safeInfo.address as Hex,
      owners: safeInfo.owners as Hex[],
      deployedOn: codes.filter((c) => c.code !== '0x').map((c) => c.chainId),
      requiresModules: safeInfo.owners.length === 1 && safeInfo.owners[0] === safeNullOwner
    }
  }

  /**
   * The Safe API doesn't know addresses that aren't Safe accounts (e.g. an older Gnosis
   * MultiSigWallet), so when it fails, check on chain whether the contract is a Safe at all.
   * Telling the user to try again only makes sense if it is.
   * The check is time-bound so an unresponsive network can't keep the import loading for minutes.
   */
  async #getSafeInfoFailedMessage(
    safeAddr: string,
    provider: RPCProvider,
    safeInfoError: Error
  ): Promise<string> {
    try {
      const isSafe = await withTimeout(() => isSafeContract(safeAddr, provider), {
        timeoutMs: SAFE_API_TIMEOUT_MS,
        message: `Safe check: getThreshold() call timed out after ${SAFE_API_TIMEOUT_MS}ms`
      })
      if (!isSafe) return NOT_A_SAFE_ACCOUNT_MESSAGE
    } catch (error) {
      this.emitError({
        level: 'silent',
        message: 'Failed to check if the imported address is a Safe account',
        error: error instanceof Error ? error : new Error(String(error))
      })
    }

    this.emitError({
      level: 'silent',
      message: 'Failed to retrieve information about the imported Safe account',
      error: safeInfoError
    })
    return SAFE_INFO_FETCH_FAILED_MESSAGE
  }

  async findSafe(safeAddr: string) {
    await this.withStatus('findSafe', () => this.#findSafe(safeAddr), true)
  }

  async resetFind() {
    this.safeInfo = undefined
    this.importError = undefined
  }

  resetSearchByOwner() {
    this.ownerCurrentlyDisplayingFor = undefined
    this.emitUpdate()
  }
  async findSafesByOwner(ownerAddress: string) {
    await this.#featureFlags.initialLoadPromise
    // The UI asks the user to turn the Safe API back on before searching
    if (!this.#isSafeApiEnabled) return
    const owner = getAddress(ownerAddress) as Hex
    await this.#networks.initialLoadPromise

    const safeNetworks = this.#networks.networks.filter((network) =>
      SAFE_NETWORKS.includes(Number(network.chainId))
    )

    this.ownerCurrentlyDisplayingFor = owner
    const dataForCurrent = this.safeOwnerSearches[owner]
    if (
      dataForCurrent &&
      dataForCurrent.status === 'DONE' &&
      dataForCurrent.updatedAt > Date.now() - SAFE_OWNER_SEARCH_TTL &&
      !dataForCurrent.failedNetworks.length &&
      safeNetworks.every(({ chainId }) => dataForCurrent.searchedNetworks.includes(chainId))
    ) {
      this.emitUpdate()
      return
    }
    if (
      dataForCurrent?.status === 'LOADING' &&
      dataForCurrent.updatedAt > Date.now() - SAFE_OWNER_SEARCH_DEBOUNCE
    )
      return

    const accountsByAddress = new Map<string, SafeAccountByOwner>()
    this.safeOwnerSearches[owner] = {
      owner,
      accounts: [],
      searchedNetworks: [],
      failedNetworks: [],
      updatedAt: Date.now(),
      status: 'LOADING'
    }
    this.emitUpdate()

    for (let i = 0; i < safeNetworks.length; i += SAFE_API_BATCH_SIZE) {
      const networkBatch = safeNetworks.slice(i, i + SAFE_API_BATCH_SIZE)
      const batchResults = await Promise.allSettled(
        networkBatch.map(async (network) => {
          const response = await withTimeout(
            () => getApiKit(network.chainId).getSafesByOwner(owner),
            {
              timeoutMs: SAFE_API_TIMEOUT_MS,
              message: `Safe API: owner search timed out after ${SAFE_API_TIMEOUT_MS}ms`
            }
          )
          return { chainId: network.chainId, safes: response.safes }
        })
      )

      const failedNetworks: bigint[] = []
      const deployedOnByAddress = new Map<string, { address: string; chainIds: bigint[] }>()

      batchResults.forEach((result, index) => {
        const network = networkBatch[index]!
        if (result.status === 'rejected') {
          failedNetworks.push(network.chainId)
          console.error(`Failed to search Safe accounts on network ${network.name}`, result.reason)
          return
        }

        result.value.safes.forEach((safeAddr) => {
          const normalizedAddress = safeAddr.toLowerCase()
          const existing = deployedOnByAddress.get(normalizedAddress)
          if (existing) {
            existing.chainIds.push(result.value.chainId)
            return
          }
          deployedOnByAddress.set(normalizedAddress, {
            address: safeAddr,
            chainIds: [result.value.chainId]
          })
        })
      })

      const newSafeEntries = Array.from(deployedOnByAddress.entries()).filter(
        ([address]) => !accountsByAddress.has(address)
      )
      for (let safeIndex = 0; safeIndex < newSafeEntries.length; safeIndex += SAFE_API_BATCH_SIZE) {
        const safeBatch = newSafeEntries.slice(safeIndex, safeIndex + SAFE_API_BATCH_SIZE)
        const safeAccounts = await Promise.all(
          safeBatch.map(([, safeData]) =>
            getSafeAccountByOwner(safeData.address, owner, safeData.chainIds)
          )
        )
        safeAccounts.forEach(({ account, failed }, index) => {
          if (account) {
            accountsByAddress.set(account.addr.toLowerCase(), account)
            return
          }
          if (failed) failedNetworks.push(...safeBatch[index]![1].chainIds)
        })

        // we use this to show results immediately to the user
        this.safeOwnerSearches[owner] = {
          owner,
          accounts: Array.from(accountsByAddress.values()),
          searchedNetworks: this.safeOwnerSearches[owner]?.searchedNetworks || [],
          failedNetworks: this.safeOwnerSearches[owner]?.failedNetworks || [],
          updatedAt: Date.now(),
          status: 'LOADING'
        }
        this.emitUpdate()
      }

      deployedOnByAddress.forEach(({ chainIds }, address) => {
        const account = accountsByAddress.get(address)
        if (!account) return
        account.deployedOn = Array.from(new Set([...account.deployedOn, ...chainIds]))
      })

      this.safeOwnerSearches[owner] = {
        owner,
        accounts: Array.from(accountsByAddress.values()),
        searchedNetworks: [
          ...(this.safeOwnerSearches[owner]?.searchedNetworks || []),
          ...networkBatch.map((network) => network.chainId)
        ],
        failedNetworks: Array.from(
          new Set([...(this.safeOwnerSearches[owner]?.failedNetworks || []), ...failedNetworks])
        ),
        updatedAt: Date.now(),
        status: 'LOADING'
      }
      this.emitUpdate()
    }

    this.safeOwnerSearches[owner] = {
      ...this.safeOwnerSearches[owner]!,
      updatedAt: Date.now(),
      status: 'DONE'
    }
    this.emitUpdate()
  }

  getMessageId(msg: SafeMessage): string {
    return `${msg.messageHash}`
  }

  #filterOutHidden(pending: SafeResults, safeAddr: string): SafeResults {
    const hiddenMessages = [...this.#rejectedSafeTxns]

    return Object.assign(
      {},
      ...Object.keys(pending).map((chainId) => {
        const state = this.#accounts.accountStates[safeAddr]?.[chainId]
        return {
          [chainId]: {
            txns: pending[chainId]!.txns,
            messages: pending[chainId]!.messages.filter((m) => {
              return (
                // filter out rejected msgs by the user
                !hiddenMessages.includes(this.getMessageId(m)) &&
                !hiddenMessages.includes(
                  `${this.getMessageId(m)}-${new Date(m.created).getTime()}`
                ) &&
                // and those that the user cannot sign
                (state?.threshold || 0) > m.confirmations.length
              )
            })
          }
        }
      })
    )
  }

  /**
   * The Safe's owners on the chain, from its account state, where they're read onchain. Undefined
   * when the state isn't loaded, so that confirmations are then checked only against their
   * signatures, the same as before the owners were checked
   */
  #getOwners(safeAddr: string, chainId: bigint | string): string[] | undefined {
    const owners = this.#accounts.accountStates[safeAddr]?.[chainId.toString()]?.associatedKeys

    return owners?.length ? owners : undefined
  }

  /**
   * The Safe message from the Safe Transaction Service if it matches its Safe message hash, with
   * only the owner confirmations that could be verified (see getVerifiedSafeConfirmations).
   * Whether it's confirmed and its prepared signature are worked out again from them, as the
   * prepared signature is what the app that asked for the message gets. Null if the hash doesn't
   * match the message
   */
  async #verifyMessage(
    safeAddr: Hex,
    chainId: bigint,
    threshold: number,
    message: SafeMessage
  ): Promise<ExtendedSafeMessage | null> {
    if (!isSafeMessageHashValid(message, safeAddr, chainId)) return null

    // A contract owner (e.g. another Safe) signs a message with a contract signature, which the
    // signature the app gets can carry (see sortSigs)
    const confirmations = await getVerifiedSafeConfirmations(
      safeAddr,
      message.messageHash,
      message.confirmations,
      this.#providers.providers[chainId.toString()],
      { owners: this.#getOwners(safeAddr, chainId), acceptContractSignatures: true }
    )

    return {
      ...message,
      confirmations,
      isConfirmed: threshold > 0 && confirmations.length >= threshold,
      preparedSignature: sortSigs(
        confirmations.map(({ signature }) => signature as Hex),
        message.messageHash,
        confirmations
      )
    }
  }

  /**
   * Keeps the pending Safe txns and messages from the Safe Transaction Service that match their
   * hash, each with only the owner confirmations that could be verified. The owners sign and
   * execute these from the app, so what the service returns isn't trusted
   */
  async #verifyPending(
    safeAddr: Hex,
    pending: SafeResults,
    networks: SafePendingFetchNetwork[]
  ): Promise<SafeResults> {
    const verifiedPending: SafeResults = {}

    for (const [chainId, { txns, messages }] of Object.entries(pending)) {
      const safeVersion = this.#accounts.accountStates[safeAddr]?.[chainId]?.safeVersion
      const validTxns = txns.filter((txn) =>
        isSafeTxHashValid(txn, safeAddr, BigInt(chainId), safeVersion)
      )
      const threshold = networks.find((n) => n.chainId.toString() === chainId)?.threshold ?? 0
      const verifiedMessages = (
        await Promise.all(
          messages.map((message) =>
            this.#verifyMessage(safeAddr, BigInt(chainId), threshold, message)
          )
        )
      ).filter((message) => message !== null)

      if (validTxns.length !== txns.length || verifiedMessages.length !== messages.length) {
        this.emitError({
          level: 'silent',
          message: 'Ignored pending Safe transactions or messages that do not match their hash',
          error: new Error(
            `safe: ${txns.length - validTxns.length} pending txn(s) and ${messages.length - verifiedMessages.length} message(s) of ${safeAddr} on chain ${chainId} do not match their hash`
          )
        })
      }

      const provider = this.#providers.providers[chainId]
      const verifiedTxns = await Promise.all(
        validTxns.map(async (txn) =>
          txn.confirmations
            ? {
                ...txn,
                confirmations: await getVerifiedSafeConfirmations(
                  safeAddr,
                  txn.safeTxHash,
                  txn.confirmations,
                  provider,
                  { owners: this.#getOwners(safeAddr, chainId) }
                )
              }
            : txn
        )
      )

      verifiedPending[chainId] = { txns: verifiedTxns, messages: verifiedMessages }
    }

    return verifiedPending
  }

  shouldSkipFetchPending(safeAddr: string, maxAge = FETCH_SAFE_TXNS): boolean {
    const fetchedAt = this.#pendingFetchedAt[safeAddr]

    return fetchedAt !== undefined && Date.now() - fetchedAt < maxAge
  }

  /**
   * Fetches the pending txns and messages of a Safe and updates its pending counts.
   * Returns null without asking the Safe API while the wallet is locked.
   */
  async fetchPending(
    safeAddr: Hex,
    networks: SafePendingFetchNetwork[]
  ): Promise<SafeResults | null> {
    await this.#featureFlags.initialLoadPromise
    if (!this.#canSyncWithSafeApi) return null

    this.#pendingFetchedAt[safeAddr] = Date.now()
    const pending = await fetchAllPending(networks, safeAddr)
    if (!pending) return null
    // Opted out while the request was on its way: its answer would bring back the counts
    // (and the requests the MainController builds from it) that opting out has just cleared
    if (!this.#isSafeApiEnabled) return null

    const verifiedPending = await this.#verifyPending(safeAddr, pending, networks)
    const visiblePending = this.#filterOutHidden(verifiedPending, safeAddr)
    this.#setPendingCounts(safeAddr, visiblePending)
    return visiblePending
  }

  #setPendingCounts(safeAddr: string, pending: SafeResults) {
    const countByChainId = { ...this.pendingCountBySafe[safeAddr] }
    Object.entries(pending).forEach(([chainId, { txns, messages }]) => {
      countByChainId[chainId] = txns.length + messages.length
    })

    // A new object per Safe, so the UI can tell which Safe's counts changed
    this.pendingCountBySafe = { ...this.pendingCountBySafe, [safeAddr]: countByChainId }
    this.emitUpdate()
  }

  /**
   * Refreshes the pending counts of the user's Safes other than the selected one, whose
   * pending txns `MainController.fetchSafeTxns` turns into requests instead. A Safe is
   * skipped while its counts are younger than `FETCH_OTHER_SAFES_PENDING`, and until at least
   * one of its owners is imported, as without one the user cannot sign what is pending. The
   * counts of a Safe whose owners were all removed are cleared.
   */
  async updateOtherSafesPendingCounts(selectedAccountAddr?: string) {
    if (this.#updateOtherSafesPendingCountsPromise)
      return this.#updateOtherSafesPendingCountsPromise

    this.#updateOtherSafesPendingCountsPromise = this.#updateOtherSafesPendingCounts(
      selectedAccountAddr
    ).finally(() => {
      this.#updateOtherSafesPendingCountsPromise = undefined
    })

    return this.#updateOtherSafesPendingCountsPromise
  }

  /**
   * Drops the counts of the Safes that are not selected and no longer have an owner imported,
   * as they are not refreshed anymore. Forgetting when they were fetched lets an owner that is
   * imported again bring the count back right away.
   */
  #clearCountsOfSafesWithoutOwner(selectedAccountAddr?: string) {
    const safesWithoutOwner = this.#accounts.accounts.filter(
      (account) =>
        !!account.safeCreation &&
        account.addr !== selectedAccountAddr &&
        !!this.pendingCountBySafe[account.addr] &&
        !this.#keystore.getAccountKeys(account).length
    )
    if (!safesWithoutOwner.length) return

    const pendingCountBySafe = { ...this.pendingCountBySafe }
    safesWithoutOwner.forEach(({ addr }) => {
      delete pendingCountBySafe[addr]
      delete this.#pendingFetchedAt[addr]
    })
    this.pendingCountBySafe = pendingCountBySafe
    this.emitUpdate()
  }

  /**
   * Returns the on-chain states of a Safe that is not selected, refreshed on the chains it's
   * deployed on. Only the selected account's state is kept fresh, so the stored one may be
   * from long ago, and an old nonce would count replaced txns that can never execute as
   * pending. A failed refresh keeps the previous state, as the accounts controller does.
   */
  async #getFreshOtherSafeStates(safeAddr: string) {
    const hadAccountState = !!this.#accounts.accountStates[safeAddr]
    const accountState = await this.#accounts.getOrFetchAccountStates(safeAddr)
    // A state that was just fetched is fresh already
    if (!hadAccountState) return accountState

    const deployedChainIds = this.#networks.networks
      .filter(({ chainId }) => accountState?.[chainId.toString()]?.isDeployed)
      .map(({ chainId }) => chainId)
    if (!deployedChainIds.length) return accountState

    await this.#accounts.updateAccountState(safeAddr, 'latest', deployedChainIds)
    return this.#accounts.accountStates[safeAddr]
  }

  async #updateOtherSafesPendingCounts(selectedAccountAddr?: string) {
    await this.#featureFlags.initialLoadPromise
    if (!this.#canSyncWithSafeApi) return

    this.#clearCountsOfSafesWithoutOwner(selectedAccountAddr)

    const safesToUpdate = this.#accounts.accounts.filter(
      (account) =>
        !!account.safeCreation &&
        account.addr !== selectedAccountAddr &&
        !!this.#keystore.getAccountKeys(account).length &&
        !this.shouldSkipFetchPending(account.addr, FETCH_OTHER_SAFES_PENDING)
    )
    let isFirstRequest = true

    // One chain of one Safe at a time, to stay under the Safe API's rate limit
    for (const safe of safesToUpdate) {
      const accountState = await this.#getFreshOtherSafeStates(safe.addr)
      const deployedChains = this.#networks.networks.filter(
        ({ chainId }) => accountState?.[chainId.toString()]?.isDeployed
      )

      for (const { chainId } of deployedChains) {
        const chainAccountState = accountState?.[chainId.toString()]
        if (!chainAccountState) continue

        if (!isFirstRequest) await wait(SAFE_PENDING_REQUEST_PAUSE)
        isFirstRequest = false

        // the wallet may get locked (or opted out) while the Safes are updated one by one
        if (!this.#canSyncWithSafeApi) return

        const { threshold, nonce } = chainAccountState
        await this.fetchPending(safe.addr as Hex, [{ chainId, threshold, nonce }]).catch(
          (error) => {
            this.emitError({
              level: 'silent',
              message: 'Failed to fetch the pending transactions of a Safe account',
              error
            })
          }
        )
      }
    }
  }

  /**
   * Fetches the Safe txns from the nonces of the passed chains on. The ones still waiting for
   * the owners keep only the owner confirmations that could be verified (see
   * getVerifiedSafeConfirmations), as they are added to the signatures of open requests
   */
  async fetchExecuted(
    safeAddr: Hex,
    chains: { chainId: bigint; minNonce: number }[]
  ): Promise<SafeFetchedTransaction[]> {
    await this.#featureFlags.initialLoadPromise
    // do not make Safe requests if the extension is locked or the user opted out
    if (!this.#canSyncWithSafeApi) return []

    const txns = await fetchExecutedTransactions(safeAddr, chains)

    return Promise.all(
      txns.map(async (txn) =>
        txn.confirmations
          ? {
              ...txn,
              confirmations: await getVerifiedSafeConfirmations(
                safeAddr,
                txn.safeTxnHash,
                txn.confirmations,
                this.#providers.providers[txn.chainId.toString()],
                { owners: this.#getOwners(safeAddr, txn.chainId) }
              )
            }
          : txn
      )
    )
  }

  async rejectTxnId(safeTxnIds: string[]) {
    this.#rejectedSafeTxns = [...new Set([...this.#rejectedSafeTxns, ...safeTxnIds])]
    return this.#storage.set('rejectedSafeTxns', this.#rejectedSafeTxns)
  }

  async restoreTxnId(safeTxnIds: string[]) {
    this.#rejectedSafeTxns = this.#rejectedSafeTxns.filter((id) => !safeTxnIds.includes(id))
    return this.#storage.set('rejectedSafeTxns', this.#rejectedSafeTxns)
  }

  /**
   * Fetches the Safe messages of the Safe with the passed hashes. A message is returned only if
   * it's the one asked for and matches its hash, with only the owner confirmations that could be
   * verified (see #verifyMessage)
   */
  async getMessagesByHash(
    safeAddr: Hex,
    data: { chainId: bigint; threshold: number; messageHash: Hex }[]
  ): Promise<ExtendedSafeMessage[]> {
    await this.#featureFlags.initialLoadPromise
    const messages = []
    for (let i = 0; i < data.length; i++) {
      // do not make Safe requests if locked or opted out, even if it happened midway
      if (!this.#canSyncWithSafeApi) break

      const entry = data[i]!
      const msg = await getMessage(entry).catch((e) => e)
      if (!msg || msg instanceof Error) continue

      const verifiedMsg =
        msg.messageHash.toLowerCase() === entry.messageHash.toLowerCase()
          ? await this.#verifyMessage(safeAddr, entry.chainId, entry.threshold, msg)
          : null
      if (!verifiedMsg) {
        this.emitError({
          level: 'silent',
          message: 'Ignored a Safe message that does not match its hash',
          error: new Error(
            `safe: the Safe API returned a message of ${safeAddr} on chain ${entry.chainId} that does not match the hash ${entry.messageHash}`
          )
        })
        continue
      }

      messages.push(verifiedMsg)
    }
    return messages
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
