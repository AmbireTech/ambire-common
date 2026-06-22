import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { INetworksController, Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { VerificationStatuses } from '../../interfaces/verification'
import {
  getDefaultColibriProverUrl,
  isColibriProviderAvailable
} from '../../libs/networks/colibri'
import { getColibriRpcProvider } from '../../services/provider/colibri'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'

const SYNC_HEALTH_CHECK_RETRY_INTERVAL = 10000

type VerifierProvider = {
  connectionUrl: string
  provider: RPCProvider
}

type VerifierConfig = {
  connectionUrl: string
  proverUrl: string
}

const isOutOfSyncError = (error: any) =>
  (error?.message || error?.toString?.() || '').toLowerCase().includes('out of sync')

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
        provider: 'colibri',
        error: 'Colibri verifier provider was shut down',
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

  #getVerifierConfig(network: Network): VerifierConfig | null {
    if (network.disabled) return null
    if (!network.isColibriEnabled) return null
    if (!isColibriProviderAvailable(network.chainId)) return null

    const proverUrl =
      network.colibriProverUrl?.trim() || getDefaultColibriProverUrl(network.chainId)
    if (!proverUrl) return null

    return {
      proverUrl,
      connectionUrl: `colibri:${network.selectedRpcUrl}:${proverUrl}`
    }
  }

  #syncNetwork(network: Network) {
    const stringChainId = network.chainId.toString()
    const verifierConfig = this.#getVerifierConfig(network)

    if (!verifierConfig) {
      this.#destroyProvider(network.chainId)
      delete this.#syncPromises[stringChainId]
      delete this.#connectionUrls[stringChainId]
      this.#setStatus(network.chainId, { status: 'not-configured', updatedAt: Date.now() })
      return
    }

    const { connectionUrl, proverUrl } = verifierConfig
    const currentConnectionUrl = this.#connectionUrls[stringChainId]
    const currentStatus = this.statusesByChainId[stringChainId]?.status

    if (
      currentConnectionUrl === connectionUrl &&
      (currentStatus === 'syncing' || currentStatus === 'ready')
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
    this.#setStatus(network.chainId, {
      status: 'syncing',
      provider: 'colibri',
      updatedAt: Date.now()
    })

    let syncPromise!: Promise<void>
    syncPromise = (async () => {
      let provider: RPCProvider | null = null

      try {
        provider = await Promise.resolve(
          getColibriRpcProvider({
            ...network,
            colibriProverUrl: proverUrl
          })
        )

        if (this.#syncPromises[stringChainId]?.promise !== syncPromise) {
          this.#destroyRpcProvider(provider)
          return
        }

        this.#providers[stringChainId] = {
          connectionUrl,
          provider
        }

        while (this.#syncPromises[stringChainId]?.promise === syncPromise) {
          try {
            await (provider as any).waitSynced?.()
            await provider.send('eth_blockNumber', [])

            if (this.#syncPromises[stringChainId]?.promise !== syncPromise) {
              this.#destroyRpcProvider(provider)
              return
            }

            this.#setStatus(network.chainId, {
              status: 'ready',
              provider: 'colibri',
              updatedAt: Date.now()
            })
            return
          } catch (syncError: any) {
            if (!isOutOfSyncError(syncError)) throw syncError

            this.#setStatus(network.chainId, {
              status: 'syncing',
              provider: 'colibri',
              error: syncError?.message || 'Colibri verifier is out of sync',
              updatedAt: Date.now()
            })
            await wait(SYNC_HEALTH_CHECK_RETRY_INTERVAL)
          }
        }

        this.#destroyRpcProvider(provider)
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
          provider: 'colibri',
          error: error?.message || 'Failed to initialize Colibri verifier',
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
