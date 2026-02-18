import { toBeHex } from 'ethers'

import SafeApiKit, {
  SafeCreationInfoResponse,
  SafeInfoResponse,
  SafeMessage
} from '@safe-global/api-kit'

import { FETCH_SAFE_TXNS } from '../../consts/intervals'
import { SAFE_NETWORKS, safeNullOwner } from '../../consts/safe'
import { IAccountsController, SafeAccountCreation } from '../../interfaces/account'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { Hex } from '../../interfaces/hex'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { ISafeController } from '../../interfaces/safe'
import { IStorageController } from '../../interfaces/storage'
import {
  ExtendedSafeMessage,
  fetchAllPending,
  fetchExecutedTransactions,
  getCalculatedSafeAddress,
  getMessage,
  SafeResults
} from '../../libs/safe/safe'
import EventEmitter from '../eventEmitter/eventEmitter'

export const STATUS_WRAPPED_METHODS = {
  findSafe: 'INITIAL'
} as const

export class SafeController extends EventEmitter implements ISafeController {
  #storage: IStorageController

  #networks: INetworksController

  #accounts: IAccountsController

  #providers: IProvidersController

  /**
   * The last time a request to fetch pending safe txn was made
   */
  #updatedAt: number = 0

  #automaticallyResolvedSafeTxns: { nonce: bigint; txnIds: string[] }[] = []

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

  /**
   * Check if the passed safeAddr is deployed on any chain that:
   * - the user has enabled in the extension +
   * - safe contracts are deployed on and are in our config, SAFE_NETWORKS
   * If deployed, get its config and check if we support it.
   * If we do, allow import of that safe
   */
  async #findSafe(safeAddr: string) {
    this.importError = undefined
    this.safeInfo = undefined

    // search enabled networks that are safe supported
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
          .catch((e) => ({ chainId: n.chainId, code: '0x' }))
      )
    )
    const deployedOn = codes.find((c) => c.code && c.code !== '0x')
    if (!deployedOn) {
      this.importError = {
        address: safeAddr,
        message: `The Safe account is not deployed on any of your enabled networks that have Safe support: ${safeNetworks.map((n) => n.name).join(',')}. Please deploy it from safe global on at least one network before continuing`
      }
      return
    }

    const apiKit = new SafeApiKit({
      chainId: deployedOn.chainId,
      apiKey: process.env.SAFE_API_KEY
    })
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
        message: 'Failed to retrieve information about the safe. Please try again'
      }
      return
    }

    const calculatedAddr = await getCalculatedSafeAddress(
      safeCreationInfo,
      this.#providers.providers[deployedOn.chainId.toString()]!
    )
    if (!calculatedAddr || calculatedAddr.toLowerCase() !== safeAddr.toLowerCase()) {
      this.importError = {
        address: safeAddr,
        message: 'Failed to retrieve information about the safe. Please try again'
      }
      return
    }

    const setupData = safeCreationInfo.setupData as Hex
    console.log('these are the owners', safeInfo.owners)
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

  getMessageId(msg: SafeMessage): string {
    return `${msg.messageHash}-${new Date(msg.created).getTime()}`
  }

  #filterOutHidden(pending: SafeResults, safeAddr: string): SafeResults {
    // filter out all resolved & rejected safe txns
    const hiddenTxns = [
      ...this.#rejectedSafeTxns,
      ...this.#automaticallyResolvedSafeTxns.map((row) => row.txnIds).flat()
    ]

    return Object.assign(
      {},
      ...Object.keys(pending).map((chainId) => {
        const state = this.#accounts.accountStates[safeAddr]?.[chainId]
        const importedKeysLength = state?.importedAccountKeys.length || 0
        return {
          [chainId]: {
            txns: pending[chainId]!.txns.filter((r) => !hiddenTxns.includes(r.safeTxHash)),
            messages: pending[chainId]!.messages.filter((m) => {
              return (
                // filter out rejected msgs by the user
                !hiddenTxns.includes(this.getMessageId(m)) &&
                // and those that the user cannot sign
                importedKeysLength > m.confirmations.length
              )
            })
          }
        }
      })
    )
  }

  async fetchPending(
    safeAddr: Hex,
    networks: { chainId: bigint; threshold: number }[],
    forceFetch = false
  ): Promise<SafeResults | null> {
    if (!forceFetch && Date.now() - this.#updatedAt < FETCH_SAFE_TXNS) return null

    this.#updatedAt = Date.now()
    const pending = await fetchAllPending(networks, safeAddr)
    if (!pending) return null

    return this.#filterOutHidden(pending, safeAddr)
  }

  async fetchExecuted(txns: { chainId: bigint; safeTxnHash: Hex }[]): Promise<
    {
      safeTxnHash: Hex
      transactionHash: Hex
      nonce: string
    }[]
  > {
    // no protection, call this only after fetching the pending ones
    this.#updatedAt = Date.now()
    return fetchExecutedTransactions(txns)
  }

  async rejectTxnId(safeTxnIds: string[]) {
    this.#rejectedSafeTxns = [...this.#rejectedSafeTxns, ...safeTxnIds]
    return this.#storage.set('rejectedSafeTxns', this.#rejectedSafeTxns)
  }

  async resolveTxnId(resolves: { txnIds: string[]; nonce: bigint }[]) {
    for (let i = 0; i < resolves.length; i++) {
      const resolve = resolves[i]!
      const resolved = this.#automaticallyResolvedSafeTxns.find(
        (txns) => txns.nonce === resolve.nonce
      )

      if (!resolved) this.#automaticallyResolvedSafeTxns.push(resolve)
      else resolved.txnIds.push(...resolve.txnIds)
    }

    return this.#storage.set('automaticallyResolvedSafeTxns', this.#automaticallyResolvedSafeTxns)
  }

  /**
   * Upon failure, unresolve all safe txns with the same nonce
   */
  async unresolve(nonce: bigint) {
    // reset the counter so we could fetch immediately
    this.#updatedAt = 0
    this.#automaticallyResolvedSafeTxns = this.#automaticallyResolvedSafeTxns.filter(
      (txns) => txns.nonce !== nonce
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
      if (msg instanceof Error) continue
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
