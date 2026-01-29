import { error } from 'console'
import { Contract } from 'ethers'

import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { INetworksController, Network } from '../../interfaces/network'
import { IProvidersController, RPCProvider, RPCProviders } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { IUiController } from '../../interfaces/ui'
/* eslint-disable no-underscore-dangle */
import { getProviderBatchMaxCount } from '../../libs/networks/networks'
import { GetOptions, Portfolio, TokenResult } from '../../libs/portfolio'
import { getRpcProvider } from '../../services/provider'
import EventEmitter from '../eventEmitter/eventEmitter'

const STATUS_WRAPPED_METHODS = {
  toggleBatching: 'INITIAL'
} as const

const RANDOM_ADDRESS = '0x0000000000000000000000000000000000000001'

/**
 * The ProvidersController manages RPC providers, enabling the extension to communicate with the blockchain.
 * Each network requires an initialized JsonRpcProvider, and the provider must be reinitialized whenever network.selectedRpcUrl changes.
 */
export class ProvidersController extends EventEmitter implements IProvidersController {
  #networks: INetworksController

  #storage: IStorageController

  #ui: IUiController

  #providers: RPCProviders = {}

  #providersProxy: RPCProviders

  #scheduledResolveAssetInfoActions: {
    [chainId: string]:
      | {
          promise: Promise<any>
          data: { callback: Function; address: string }[]
        }
      | undefined
  } = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  isBatchingEnabled = true

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  constructor(
    networks: INetworksController,
    storage: IStorageController,
    ui: IUiController,
    eventEmitterRegistry?: IEventEmitterRegistryController
  ) {
    super(eventEmitterRegistry)
    this.#networks = networks
    this.#storage = storage
    this.#ui = ui

    // Proxy over the providers map that:
    // - Lazily auto-initializes a provider when a chainId is accessed
    // - Removes and destroys providers for networks no longer in allNetworks
    // - Emits updates only when the providers set actually changes
    this.#providersProxy = new Proxy(this.#providers, {
      get: (target, prop, receiver) => {
        try {
          if (isNaN(Number(prop))) return Reflect.get(target, prop, receiver)
          if (!!this.initialLoadPromise) return Reflect.get(target, prop, receiver)

          // Clean up temp providers first (any chainId not in allNetworks)
          if (!this.#networks.networkToAddOrUpdate) {
            let shouldEmit = false
            for (const [chainIdStr, provider] of Object.entries(target)) {
              const chainId = BigInt(chainIdStr)
              const networkExists = this.#networks.allNetworks.some((n) => n.chainId === chainId)

              if (!networkExists && provider) {
                provider.destroy()
                delete target[chainIdStr]
                shouldEmit = true
              }
            }
            if (shouldEmit) this.emitUpdate()
          }

          if (prop in target) return Reflect.get(target, prop, receiver)

          const chainId = BigInt(prop.toString())
          let rpcUrl: string | undefined = undefined
          const network = this.#networks.allNetworks.find((n) => n.chainId === chainId)
          if (network) rpcUrl = network.selectedRpcUrl
          if (
            !network &&
            this.#networks.networkToAddOrUpdate &&
            this.#networks.networkToAddOrUpdate.chainId === chainId
          ) {
            rpcUrl = this.#networks.networkToAddOrUpdate.rpcUrl
          }

          this.#autoInitProvider(chainId, rpcUrl)
          this.emitUpdate()
        } catch (error) {
          console.error(`Failed to auto set provider for chainId: ${prop.toString()}`, error)
        }

        return Reflect.get(target, prop, receiver)
      },

      set: (target, prop, value, receiver) => {
        return Reflect.set(target, prop, value, receiver)
      },

      deleteProperty: (target, prop) => {
        return Reflect.deleteProperty(target, prop)
      },

      has: (target, prop) => {
        return Reflect.has(target, prop)
      },

      ownKeys: (target) => {
        return Reflect.ownKeys(target)
      },

      getOwnPropertyDescriptor: (target, prop) => {
        return Reflect.getOwnPropertyDescriptor(target, prop)
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  get providers(): RPCProviders {
    return this.#providersProxy
  }

  async #load() {
    await this.#networks.initialLoadPromise

    const storageIsBatchingEnabled = await this.#storage.get(
      'isBatchingEnabled',
      this.isBatchingEnabled
    )

    this.isBatchingEnabled = storageIsBatchingEnabled
    this.#networks.allNetworks.forEach((n) => this.setProvider(n))

    this.emitUpdate()
  }

  #autoInitProvider(chainId: bigint, rpcUrl?: string) {
    if (!rpcUrl) return

    const network = this.#networks.allNetworks.find((n) => n.chainId === chainId)

    if (network) {
      this.setProvider(network)
    } else {
      this.#providers[chainId.toString()] = getRpcProvider([rpcUrl], chainId, rpcUrl)
    }
  }

  setProvider(network: Network, opts?: { forceUpdate: boolean }) {
    const { forceUpdate = false } = opts || {}
    const stringChainId = network.chainId.toString()
    const provider = this.#providers[stringChainId]
    const isRpcUrlChanged = provider?._getConnection().url !== network.selectedRpcUrl

    if (!provider || isRpcUrlChanged || forceUpdate) {
      const oldRPC = this.#providers[stringChainId]

      try {
        if (oldRPC) oldRPC.destroy()
      } catch (error: any) {
        if (error?.message !== 'provider destroyed; cancelled request') {
          this.emitError({ error, message: error.message, level: 'silent', sendCrashReport: true })
        }
      }

      const batchMaxCount = this.isBatchingEnabled
        ? getProviderBatchMaxCount(network, network.selectedRpcUrl)
        : 1

      this.#providers[stringChainId] = getRpcProvider(
        network.rpcUrls,
        network.chainId,
        network.selectedRpcUrl,
        {
          batchMaxCount,
          batchMaxSize: network.rpcNoStateOverride ? 24576 : undefined
        }
      )
      this.#providers[stringChainId].isWorking = true
      this.#providers[stringChainId]!.batchMaxCount = batchMaxCount
    }
  }

  updateProviderIsWorking(chainId: bigint, isWorking: boolean) {
    const provider = this.providers[chainId.toString()]
    if (!provider) return
    if (provider.isWorking === isWorking) return

    provider.isWorking = isWorking
    this.emitUpdate()
  }

  removeProvider(chainId: bigint) {
    if (!this.#providers[chainId.toString()]) return

    this.#providers[chainId.toString()]?.destroy()
    delete this.#providers[chainId.toString()]
    this.emitUpdate()
  }

  toggleBatching() {
    return this.withStatus('toggleBatching', async () => {
      this.isBatchingEnabled = !this.isBatchingEnabled
      await this.#storage.set('isBatchingEnabled', this.isBatchingEnabled)

      this.#networks.allNetworks.forEach((n) => this.setProvider(n, { forceUpdate: true }))
      this.emitUpdate()
    })
  }

  async callProviderAndSendResToUi({
    requestId,
    chainId,
    method,
    args
  }: {
    requestId: string
    chainId: bigint
    method: keyof RPCProvider
    args: unknown[]
  }) {
    const provider = this.providers[chainId.toString()]
    if (!provider)
      return this.emitError({
        error: new Error('callProviderAndSendResToUi: provider not found'),
        message: 'Provider not found',
        level: 'silent'
      })

    const fn = provider[method]

    if (typeof fn !== 'function') {
      return this.emitError({
        error: new Error('callProviderAndSendResToUi: not a valid provider method'),
        message: `${method} is not a valid JsonRpcProvider method`,
        level: 'silent'
      })
    }

    try {
      const result = await (fn as Function).apply(provider, args)

      this.#ui.message.sendUiMessage({
        type: 'RpcCallRes',
        requestId,
        ok: true,
        res: result
      })
    } catch (error: any) {
      this.emitError({ error, message: error.message, level: 'major' })
      this.#ui.message.sendUiMessage({
        type: 'RpcCallRes',
        requestId,
        ok: false,
        error: error.message
      })
    }
  }

  async callContractAndSendResToUi({
    requestId,
    chainId,
    address,
    abi,
    method,
    args
  }: {
    requestId: string
    chainId: bigint
    address: string
    abi: string
    method: keyof Contract
    args: unknown[]
  }) {
    const network = this.#networks.allNetworks.find((n) => n.chainId === chainId)
    if (!network) {
      return this.emitError({
        error: new Error('callContractAndSendResToUi: network not found'),
        message: `Network with chainId: ${chainId} not found`,
        level: 'silent'
      })
    }

    const provider = this.providers[network.chainId.toString()]
    const contract = new Contract(address, [abi], provider)
    let error: any = undefined

    if (typeof contract[method] !== 'function') {
      return this.emitError({
        error: new Error('callContractAndSendResToUi: not a valid Contract method'),
        message: `${method.toString()} is not a valid Contract method`,
        level: 'silent'
      })
    }
    const result = await (contract[method] as Function).apply(contract, args)

    this.#ui.message.sendUiMessage({
      type: 'CallContract',
      requestId,
      ok: !!result,
      res: result ?? undefined,
      error: error?.message ?? undefined
    })
  }

  async #executeBatchedFetch(network: Network): Promise<void> {
    const allAddresses =
      Array.from(
        new Set(
          this.#scheduledResolveAssetInfoActions[network.chainId.toString()]?.data.map(
            (i) => i.address
          )
        )
      ) || []
    const portfolio = new Portfolio(
      fetch as any,
      this.providers[network.chainId.toString()]!,
      network
    )
    const options: Partial<GetOptions> = {
      disableAutoDiscovery: true,
      additionalErc20Hints: allAddresses,
      additionalErc721Hints: Object.fromEntries(allAddresses.map((i) => [i, [1n]]))
    }
    const portfolioResponse = await portfolio.get(RANDOM_ADDRESS, options)

    this.#scheduledResolveAssetInfoActions[network.chainId.toString()]?.data.forEach((i) => {
      const tokenInfo =
        (i.address,
        portfolioResponse.tokens.find(
          (t) => t.address.toLocaleLowerCase() === i.address.toLowerCase()
        ))
      const nftInfo =
        (i.address,
        portfolioResponse.collections.find(
          (t) => t.address.toLocaleLowerCase() === i.address.toLowerCase()
        ))

      i.callback({ tokenInfo, nftInfo })
    })
  }

  /**
   * Resolves symbol and decimals for tokens or name for nfts.
   */
  async resolveAssetInfo(
    address: string,
    network: Network,
    callback: (arg: { tokenInfo?: TokenResult; nftInfo?: { name: string } }) => void
  ): Promise<void> {
    if (!this.#scheduledResolveAssetInfoActions[network.chainId.toString()]?.data?.length) {
      this.#scheduledResolveAssetInfoActions[network.chainId.toString()] = {
        promise: new Promise((resolve, reject) => {
          setTimeout(async () => {
            await this.#executeBatchedFetch(network).catch(reject)
            this.#scheduledResolveAssetInfoActions[network.chainId.toString()] = undefined
            resolve(0)
          }, 500)
        }),
        data: [{ address, callback }]
      }
    } else {
      this.#scheduledResolveAssetInfoActions[network.chainId.toString()]?.data.push({
        address,
        callback
      })
    }
    // we are returning a promise so we can await the full execution
    return this.#scheduledResolveAssetInfoActions[network.chainId.toString()]?.promise
  }

  // TODO: Implement on the FE once the refactor is complete and
  // all controllers from the MainController are shared across Benzin, Legends, Extension, and Mobile
  // TODO: remove src/services/assetInfo/assetInfo.ts
  async resolveAssetInfoAndSendResToUi({
    requestId,
    address,
    network
  }: {
    requestId: string
    address: string
    network: Network
  }) {
    this.resolveAssetInfo(address, network, (_assetInfo: any) => {
      this.#ui.message.sendUiMessage({
        type: 'ResolveAssetInfo',
        requestId,
        ok: true,
        res: _assetInfo ?? undefined
      })
    }).catch((e) => {
      this.#ui.message.sendUiMessage({
        type: 'ResolveAssetInfo',
        requestId,
        ok: false,
        error: e.message
      })
    })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      providers: this.providers
    }
  }
}
