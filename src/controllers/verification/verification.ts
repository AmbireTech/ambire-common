import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { INetworksController, Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { VerificationStatuses } from '../../interfaces/verification'
import { getHeliosRpcProvider } from '../../services/provider/helios'
import EventEmitter from '../eventEmitter/eventEmitter'

type VerifierProvider = {
  connectionUrl: string
  provider: RPCProvider
}

export class VerificationController extends EventEmitter {
  #networks: INetworksController

  initialLoadPromise?: Promise<void>

  statusesByChainId: VerificationStatuses = {}

  #providers: { [chainId: string]: VerifierProvider | undefined } = {}

  #connectionUrls: { [chainId: string]: string | undefined } = {}

  #syncPromises: {
    [chainId: string]:
      | {
          connectionUrl: string
          promise: Promise<void>
        }
      | undefined
  } = {}

  constructor({
    eventEmitterRegistry,
    networks
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    networks: INetworksController
  }) {
    super(eventEmitterRegistry)
    this.#networks = networks
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load(): Promise<void> {
    await this.#networks.initialLoadPromise
    this.updateNetworks(this.#networks.allNetworks)
  }

  getReadyProvider(chainId: Network['chainId']): RPCProvider | null {
    const stringChainId = chainId.toString()
    if (this.statusesByChainId[stringChainId]?.status !== 'ready') return null

    const provider = this.#providers[stringChainId]?.provider
    if (!provider) return null

    if (provider.destroyed) {
      delete this.#providers[stringChainId]
      this.#setStatus(chainId, {
        status: 'failed',
        error: 'Helios verifier provider was shut down',
        updatedAt: Date.now()
      })

      return null
    }

    return provider
  }

  updateNetworks(networks: Network[]) {
    networks.forEach((network) => {
      this.#syncNetwork(network)
    })
  }

  init({ networks }: { networks: Network[] }) {
    this.updateNetworks(networks)
  }

  #setStatus(chainId: Network['chainId'], status: VerificationStatuses[string]) {
    this.statusesByChainId = {
      ...this.statusesByChainId,
      [chainId.toString()]: status
    }
    this.emitUpdate()
  }

  #destroyProvider(chainId: Network['chainId']) {
    const stringChainId = chainId.toString()
    const provider = this.#providers[stringChainId]?.provider

    this.#destroyRpcProvider(provider)

    delete this.#providers[stringChainId]
  }

  #destroyRpcProvider(provider?: RPCProvider | null) {
    if (!provider || provider.destroyed) return

    provider.destroy()
  }

  #syncNetwork(network: Network) {
    const stringChainId = network.chainId.toString()
    const heliosRpcUrl = network.heliosRpcUrl?.trim()

    if (!heliosRpcUrl || network.disabled) {
      this.#destroyProvider(network.chainId)
      delete this.#syncPromises[stringChainId]
      delete this.#connectionUrls[stringChainId]
      this.#setStatus(network.chainId, { status: 'not-configured', updatedAt: Date.now() })
      return
    }

    const connectionUrl = `helios:${network.selectedRpcUrl}:${heliosRpcUrl}`
    const currentConnectionUrl = this.#connectionUrls[stringChainId]
    const currentStatus = this.statusesByChainId[stringChainId]?.status

    if (
      currentConnectionUrl === connectionUrl &&
      (currentStatus === 'syncing' || currentStatus === 'ready' || currentStatus === 'failed')
    ) {
      return
    }

    const existingProvider = this.#providers[stringChainId]
    if (
      existingProvider?.connectionUrl === connectionUrl &&
      this.statusesByChainId[stringChainId]?.status === 'ready'
    ) {
      return
    }

    const existingSync = this.#syncPromises[stringChainId]
    if (existingSync?.connectionUrl === connectionUrl) return

    this.#destroyProvider(network.chainId)
    this.#connectionUrls[stringChainId] = connectionUrl
    this.#setStatus(network.chainId, { status: 'syncing', updatedAt: Date.now() })

    let syncPromise!: Promise<void>
    syncPromise = (async () => {
      let provider: RPCProvider | null = null

      try {
        provider = await getHeliosRpcProvider(network)

        if (this.#syncPromises[stringChainId]?.promise !== syncPromise) {
          this.#destroyRpcProvider(provider)
          return
        }

        this.#providers[stringChainId] = {
          connectionUrl,
          provider
        }

        await (provider as any).waitSynced?.()

        if (this.#syncPromises[stringChainId]?.promise !== syncPromise) {
          this.#destroyRpcProvider(provider)
          return
        }

        this.#setStatus(network.chainId, { status: 'ready', updatedAt: Date.now() })
      } catch (error: any) {
        this.#destroyRpcProvider(provider)
        if (this.#syncPromises[stringChainId]?.promise !== syncPromise) {
          if (this.#providers[stringChainId]?.provider === provider) {
            delete this.#providers[stringChainId]
          }
          return
        }

        delete this.#providers[stringChainId]

        this.#setStatus(network.chainId, {
          status: 'failed',
          error: error?.message || 'Failed to initialize Helios verifier',
          updatedAt: Date.now()
        })
      }
    })()

    this.#syncPromises[stringChainId] = {
      connectionUrl,
      promise: syncPromise
    }

    syncPromise.finally(() => {
      if (this.#syncPromises[stringChainId]?.promise === syncPromise) {
        delete this.#syncPromises[stringChainId]
      }
    })
  }
}
