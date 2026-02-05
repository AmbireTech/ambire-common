import { toBeHex } from 'ethers'

import SafeApiKit, { SafeCreationInfoResponse, SafeInfoResponse } from '@safe-global/api-kit'
import { SafeMultisigTransactionResponse } from '@safe-global/types-kit'

import { FETCH_PENDING_SAFE_TXNS } from '../../consts/intervals'
import { SAFE_NETWORKS, SAFE_SMALLEST_SUPPORTED_V } from '../../consts/safe'
import { SafeAccountCreation } from '../../interfaces/account'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { Hex } from '../../interfaces/hex'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { ISafeController } from '../../interfaces/safe'
import { IStorageController } from '../../interfaces/storage'
import {
  decodeSetupData,
  fetchAllPending,
  getCalculatedSafeAddress,
  isSupportedSafeVersion
} from '../../libs/safe/safe'
import EventEmitter from '../eventEmitter/eventEmitter'

export const STATUS_WRAPPED_METHODS = {
  findSafe: 'INITIAL'
} as const

export class SafeController extends EventEmitter implements ISafeController {
  #storage: IStorageController

  #networks: INetworksController

  #providers: IProvidersController

  /**
   * The last time a request to fetch pending safe txn was made
   */
  #updatedAt: number = 0

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
  }

  constructor({
    eventEmitterRegistry,
    networks,
    providers,
    storage
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    networks: INetworksController
    providers: IProvidersController
    storage: IStorageController
  }) {
    super(eventEmitterRegistry)
    this.#networks = networks
    this.#providers = providers
    this.#storage = storage
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    this.#rejectedSafeTxns = await this.#storage.get('rejectedSafeTxns', [])
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
    if (!isSupportedSafeVersion(safeInfo.version)) {
      this.importError = {
        address: safeAddr,
        message: `Safe version ${safeInfo.version} accounts are not supported in Ambire. Smallest support version is ${SAFE_SMALLEST_SUPPORTED_V}`
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
    const foundOwners = decodeSetupData(setupData)
    this.safeInfo = {
      version: safeInfo.version,
      address: safeInfo.address as Hex,
      owners: foundOwners.length ? foundOwners : (safeInfo.owners as Hex[]),
      deployedOn: codes.filter((c) => c.code !== '0x').map((c) => c.chainId),
      factoryAddr: safeCreationInfo.factoryAddress as Hex,
      singleton: safeCreationInfo.singleton as Hex,
      saltNonce: safeCreationInfo.saltNonce
        ? (toBeHex(BigInt(safeCreationInfo.saltNonce), 32) as Hex)
        : (toBeHex(0, 32) as Hex),
      setupData
    }
  }

  async findSafe(safeAddr: string) {
    await this.withStatus('findSafe', () => this.#findSafe(safeAddr), true)
  }

  async fetchPending(
    safeAddr: Hex
  ): Promise<{ [chainId: string]: SafeMultisigTransactionResponse[] } | null> {
    if (Date.now() - this.#updatedAt < FETCH_PENDING_SAFE_TXNS) return null

    this.#updatedAt = Date.now()
    const pending = await fetchAllPending(this.#networks.networks, safeAddr)
    if (!pending) return null

    // filter out all rejected safe txns
    return Object.assign(
      {},
      ...Object.keys(pending).map((chainId) => {
        return {
          [chainId]: pending[chainId]!.filter((r) => !this.#rejectedSafeTxns.includes(r.safeTxHash))
        }
      })
    )
  }

  async rejectTxnId(safeTxnId: string) {
    this.#rejectedSafeTxns = [...this.#rejectedSafeTxns, safeTxnId]
    return this.#storage.set('rejectedSafeTxns', this.#rejectedSafeTxns)
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
