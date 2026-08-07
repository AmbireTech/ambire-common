import { getAddress, toBeHex } from 'ethers'

import { FETCH_SAFE_TXNS } from '../../consts/intervals'
import {
  SAFE_API_BATCH_SIZE,
  SAFE_API_TIMEOUT_MS,
  SAFE_NETWORKS,
  safeNullOwner
} from '../../consts/safe'
import { IAccountsController, SafeAccountCreation } from '../../interfaces/account'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { Hex } from '../../interfaces/hex'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { ISafeController, SafeAccountByOwner } from '../../interfaces/safe'
import { AutomaticallyResolvedSafeTxn, IStorageController } from '../../interfaces/storage'
import {
  ExtendedSafeMessage,
  fetchAllPending,
  fetchExecutedTransactions,
  getApiKit,
  getMessage,
  getSafeAccountByOwner,
  SafeResults
} from '../../libs/safe/safe'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

import type { SafeCreationInfoResponse, SafeInfoResponse, SafeMessage } from '@safe-global/api-kit'
import type { SafeMultisigConfirmationResponse } from '@safe-global/types-kit'

const SAFE_OWNER_SEARCH_TTL = 5 * 60 * 1000
const SAFE_OWNER_SEARCH_DEBOUNCE = 3 * 1000

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

  #providers: IProvidersController

  /**
   * The last time a request to fetch pending Safe txn was made
   */
  #updatedAt?: { time: number; addr: string }

  #automaticallyResolvedSafeTxns: AutomaticallyResolvedSafeTxn[] = []

  #rejectedSafeTxns: string[] = []

  initialLoadPromise?: Promise<void>

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  importError?: {
    message: string
    address: string
  }

  safeInfo?: SafeAccountCreation & {
    deployedOn: bigint[]
    version: string
    address: Hex
    owners: Hex[]
    // does the safe need special conditions to send/sign txns
    requiresModules: boolean
  }

  ownerCurrentlyDisplayingFor?: Hex
  safeOwnerSearches: Record<Hex, SafeOwnerSearch> = {}

  constructor({
    eventEmitterRegistry,
    networks,
    providers,
    storage,
    accounts
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    networks: INetworksController
    providers: IProvidersController
    storage: IStorageController
    accounts: IAccountsController
  }) {
    super(eventEmitterRegistry)
    this.#networks = networks
    this.#providers = providers
    this.#storage = storage
    this.#accounts = accounts
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    await this.#accounts.initialLoadPromise
    this.#rejectedSafeTxns = await this.#storage.get('rejectedSafeTxns', [])
    this.#automaticallyResolvedSafeTxns = await this.#storage.get(
      'automaticallyResolvedSafeTxns',
      []
    )
  }

  get rejectedSafeTxns() {
    return [...this.#rejectedSafeTxns]
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
        message: `The Safe account is not deployed on any of your enabled networks that have Safe support: ${safeNetworks.map((n) => n.name).join(',')}. Please deploy it from Safe Global on at least one network before continuing`
      }
      return
    }

    const apiKit = getApiKit(deployedOn.chainId)
    const [safeInfo, safeCreationInfo]: [
      SafeInfoResponse | Error,
      SafeCreationInfoResponse | Error
    ] = await Promise.all([
      apiKit.getSafeInfo(safeAddr).catch((e) => e),
      apiKit.getSafeCreationInfo(safeAddr).catch((e) => e)
    ])
    if (safeInfo instanceof Error || safeCreationInfo instanceof Error) {
      this.importError = {
        address: safeAddr,
        message: 'Failed to retrieve information about the Safe. Please try again'
      }
      return
    }

    const setupData = safeCreationInfo.setupData as Hex
    this.safeInfo = {
      version: safeInfo.version,
      address: safeInfo.address as Hex,
      owners: safeInfo.owners as Hex[],
      deployedOn: codes.filter((c) => c.code !== '0x').map((c) => c.chainId),
      factoryAddr: safeCreationInfo.factoryAddress as Hex,
      singleton: safeCreationInfo.singleton as Hex,
      saltNonce: safeCreationInfo.saltNonce
        ? (toBeHex(BigInt(safeCreationInfo.saltNonce), 32) as Hex)
        : (toBeHex(0, 32) as Hex),
      setupData,
      requiresModules: safeInfo.owners.length === 1 && safeInfo.owners[0] === safeNullOwner
    }
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
    const resolvedSafeTxns = this.#automaticallyResolvedSafeTxns.map((row) => row.txnIds).flat()
    const hiddenMessages = [...this.#rejectedSafeTxns, ...resolvedSafeTxns]

    return Object.assign(
      {},
      ...Object.keys(pending).map((chainId) => {
        const state = this.#accounts.accountStates[safeAddr]?.[chainId]
        return {
          [chainId]: {
            txns: pending[chainId]!.txns.filter((r) => !resolvedSafeTxns.includes(r.safeTxHash)),
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

  shouldSkipFetchPending(safeAddr: string): boolean {
    return (
      !!this.#updatedAt &&
      this.#updatedAt.addr === safeAddr &&
      Date.now() - this.#updatedAt.time < FETCH_SAFE_TXNS
    )
  }

  async fetchPending(
    safeAddr: Hex,
    networks: { chainId: bigint; threshold: number }[]
  ): Promise<SafeResults | null> {
    this.#updatedAt = {
      time: Date.now(),
      addr: safeAddr
    }
    const pending = await fetchAllPending(networks, safeAddr)
    if (!pending) return null

    return this.#filterOutHidden(pending, safeAddr)
  }

  async fetchExecuted(txns: { chainId: bigint; safeTxnHash: Hex }[]): Promise<
    {
      safeTxnHash: Hex
      nonce: string
      transactionHash?: Hex
      confirmations?: SafeMultisigConfirmationResponse[]
    }[]
  > {
    return fetchExecutedTransactions(txns)
  }

  async rejectTxnId(safeTxnIds: string[]) {
    this.#rejectedSafeTxns = [...new Set([...this.#rejectedSafeTxns, ...safeTxnIds])]
    return this.#storage.set('rejectedSafeTxns', this.#rejectedSafeTxns)
  }

  async restoreTxnId(safeTxnIds: string[]) {
    this.#rejectedSafeTxns = this.#rejectedSafeTxns.filter((id) => !safeTxnIds.includes(id))
    return this.#storage.set('rejectedSafeTxns', this.#rejectedSafeTxns)
  }

  async resolveTxnId(resolves: AutomaticallyResolvedSafeTxn[]) {
    for (let i = 0; i < resolves.length; i++) {
      const resolve = resolves[i]!
      const resolved = this.#automaticallyResolvedSafeTxns.find(
        (txns) =>
          txns.accountAddr === resolve.accountAddr &&
          txns.chainId === resolve.chainId &&
          txns.nonce === resolve.nonce
      )

      if (!resolved) this.#automaticallyResolvedSafeTxns.push(resolve)
      else resolved.txnIds = [...new Set([...resolved.txnIds, ...resolve.txnIds])]
    }

    return this.#storage.set('automaticallyResolvedSafeTxns', this.#automaticallyResolvedSafeTxns)
  }

  /**
   * Upon failure, unresolve all Safe txns for the same account, network and nonce.
   * Older entries without account and network metadata are removed by nonce for compatibility.
   */
  async unresolve(accountAddr: string, chainId: bigint, nonce: bigint) {
    // reset the counter so we could fetch immediately
    this.#updatedAt = undefined

    this.#automaticallyResolvedSafeTxns = this.#automaticallyResolvedSafeTxns.filter(
      (txns) =>
        txns.nonce !== nonce ||
        (!!txns.accountAddr && txns.accountAddr !== accountAddr) ||
        (typeof txns.chainId !== 'undefined' && txns.chainId !== chainId)
    )
    return this.#storage.set('automaticallyResolvedSafeTxns', this.#automaticallyResolvedSafeTxns)
  }

  async getMessagesByHash(
    data: { chainId: bigint; threshold: number; messageHash: Hex }[]
  ): Promise<ExtendedSafeMessage[]> {
    const messages = []
    for (let i = 0; i < data.length; i++) {
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
      ...super.toJSON(),
      rejectedSafeTxns: this.rejectedSafeTxns
    }
  }
}
