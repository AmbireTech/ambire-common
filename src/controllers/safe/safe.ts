import SafeApiKit, { SafeInfoResponse } from '@safe-global/api-kit'

import { SAFE_NETWORKS, SAFE_SMALLEST_SUPPORTED_V } from '../../consts/safe'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { ISafeController } from '../../interfaces/safe'
import { isSupportedSafeVersion } from '../../libs/safe/safe'
import EventEmitter from '../eventEmitter/eventEmitter'

export const STATUS_WRAPPED_METHODS = {
  findSafe: 'INITIAL'
} as const

export class SafeController extends EventEmitter implements ISafeController {
  #networks: INetworksController

  #providers: IProvidersController

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  errorMessage: string = ''

  safeInfo?: SafeInfoResponse

  constructor({
    eventEmitterRegistry,
    networks,
    providers
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    networks: INetworksController
    providers: IProvidersController
  }) {
    super(eventEmitterRegistry)
    this.#networks = networks
    this.#providers = providers
  }

  /**
   * Check if the passed safeAddr is deployed on any chain that:
   * - the user has enabled in the extension +
   * - safe contracts are deployed on and are in our config, SAFE_NETWORKS
   * If deployed, get its config and check if we support it.
   * If we do, allow import of that safe
   */
  async #findSafe(safeAddr: string) {
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
    const firstChainWithCode = codes.find((c) => c.code && c.code !== '0x')
    if (!firstChainWithCode) {
      this.errorMessage = `The Safe account is not deployed on any of your enabled networks that have Safe support: ${safeNetworks.map((n) => n.name).join(',')}. Please deploy it from safe global on at least one network before continuing`
      return
    }

    const apiKit = new SafeApiKit({
      chainId: firstChainWithCode.chainId,
      apiKey: process.env.SAFE_API_KEY
    })
    const safeInfo: SafeInfoResponse | Error = await apiKit.getSafeInfo(safeAddr).catch((e) => e)
    if (safeInfo instanceof Error) {
      this.errorMessage = 'Failed to retrieve information about the safe. Please try again'
      return
    }
    if (!isSupportedSafeVersion(safeInfo.version)) {
      this.errorMessage = `Safe version ${safeInfo.version} accounts are not supported in Ambire. Smallest support version is ${SAFE_SMALLEST_SUPPORTED_V}`
      return
    }

    this.safeInfo = safeInfo
  }

  async findSafe(safeAddr: string) {
    await this.withStatus('findSafe', () => this.#findSafe(safeAddr), true)
  }
}
