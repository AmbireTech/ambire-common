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
  isSafeContract,
  SafePendingFetchNetwork,
  SafeResults
} from '../../libs/safe/safe'
import wait from '../../utils/wait'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

import type { SafeInfoResponse, SafeMessage } from '@safe-global/api-kit'
import type { SafeMultisigConfirmationResponse } from '@safe-global/types-kit'

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
    keystore
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    networks: INetworksController
    providers: IProvidersController
    storage: IStorageController
    accounts: IAccountsController
    keystore: IKeystoreController
  }) {
    super(eventEmitterRegistry)
    this.#networks = networks
    this.#providers = providers
    this.#storage = storage
    this.#accounts = accounts
    this.#keystore = keystore
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
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
    // do not make Safe requests if the extension is locked
    if (!this.#keystore.isUnlocked) return null

    this.#pendingFetchedAt[safeAddr] = Date.now()
    const pending = await fetchAllPending(networks, safeAddr)
    if (!pending) return null

    const visiblePending = this.#filterOutHidden(pending, safeAddr)
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
    // do not make Safe requests if the extension is locked
    if (!this.#keystore.isUnlocked) return

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

        // the wallet may get locked while the Safes are updated one after the other
        if (!this.#keystore.isUnlocked) return

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

  async fetchExecuted(
    safeAddr: Hex,
    chains: { chainId: bigint; minNonce: number }[]
  ): Promise<
    {
      safeTxnHash: Hex
      nonce: string
      transactionHash?: Hex
      confirmations?: SafeMultisigConfirmationResponse[]
    }[]
  > {
    // do not make Safe requests if the extension is locked
    if (!this.#keystore.isUnlocked) return []

    return fetchExecutedTransactions(safeAddr, chains)
  }

  async rejectTxnId(safeTxnIds: string[]) {
    this.#rejectedSafeTxns = [...new Set([...this.#rejectedSafeTxns, ...safeTxnIds])]
    return this.#storage.set('rejectedSafeTxns', this.#rejectedSafeTxns)
  }

  async restoreTxnId(safeTxnIds: string[]) {
    this.#rejectedSafeTxns = this.#rejectedSafeTxns.filter((id) => !safeTxnIds.includes(id))
    return this.#storage.set('rejectedSafeTxns', this.#rejectedSafeTxns)
  }

  async getMessagesByHash(
    data: { chainId: bigint; threshold: number; messageHash: Hex }[]
  ): Promise<ExtendedSafeMessage[]> {
    const messages = []
    for (let i = 0; i < data.length; i++) {
      // do not make Safe requests if the extension is locked, even if it got locked midway
      if (!this.#keystore.isUnlocked) break

      const entry = data[i]!
      const msg = await getMessage(entry).catch((e) => e)
      if (!msg || msg instanceof Error) continue
      messages.push(msg)
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
