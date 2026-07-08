import { Account } from '../../interfaces/account'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { INetworksController, Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { VerificationStatuses } from '../../interfaces/verification'
import { getDefaultColibriProverUrl, isColibriProviderAvailable } from '../../libs/networks/colibri'
import { GetOptions, Portfolio } from '../../libs/portfolio'
import {
  PortfolioLibGetResult,
  PortfolioVerification,
  TokenDataCache
} from '../../libs/portfolio/interfaces'
import { getColibriRpcProvider } from '../../services/provider/colibri'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'

const SYNC_HEALTH_CHECK_RETRY_INTERVAL = 10000
export const COLIBRI_CATCH_UP_RETRY_INTERVAL = 3000
export const COLIBRI_CATCH_UP_RETRIES = 5

// When comparing the RPC head with the Colibri head, allow a small gap before
// declaring the data non-comparable. Ethereum blocks are ~12s apart, so a
// smaller threshold is enough; faster chains need a larger one.
const ETHEREUM_COLIBRI_BLOCK_DIFF_THRESHOLD = 5
const DEFAULT_COLIBRI_BLOCK_DIFF_THRESHOLD = 10

type VerifierProvider = {
  connectionUrl: string
  provider: RPCProvider
}

type VerifierConfig = {
  connectionUrl: string
  proverUrl: string
}

export type VerifyPortfolioParams = {
  account: Account
  network: Network
  // The RPC portfolio result to be verified. Its `blockNumber` is the block the
  // balances were fetched at and the exact block Colibri will be asked to prove.
  rpcResult: PortfolioLibGetResult
  // Everything the RPC `get` was called with, except `blockTag` and
  // `tokenDataCache` (those are supplied by the verifier itself), so Colibri
  // discovers the exact same token set.
  getOptions: Partial<GetOptions>
  tokenDataCache: TokenDataCache
}

const isOutOfSyncError = (error: any) =>
  (error?.message || error?.toString?.() || '').toLowerCase().includes('out of sync')

export class VerificationController extends EventEmitter {
  #networks: INetworksController

  #fetch: Fetch

  #velcroUrl: string

  initialLoadPromise?: Promise<void>

  statusesByChainId: VerificationStatuses = {}

  #providers: { [chainId: string]: VerifierProvider | undefined } = {}

  #connectionUrls: { [chainId: string]: string | undefined } = {}

  // Reused Colibri-backed portfolio libs, keyed by `${chainId}:${accountId}`.
  #verificationPortfolioLibs: Map<string, Portfolio> = new Map()

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
    networks,
    fetch,
    velcroUrl
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    networks: INetworksController
    fetch: Fetch
    velcroUrl: string
  }) {
    super(eventEmitterRegistry)
    this.#networks = networks
    this.#fetch = fetch
    this.#velcroUrl = velcroUrl
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

  #getVerificationPortfolioLib(
    account: Account,
    network: Network,
    provider: RPCProvider
  ): Portfolio {
    const key = `${network.chainId}:${account.addr}`
    const libForKey = this.#verificationPortfolioLibs.get(key)

    // Recreate the lib when the underlying Colibri provider was swapped (e.g. after a resync)
    if (!libForKey || libForKey.provider !== provider) {
      this.#verificationPortfolioLibs.set(
        key,
        new Portfolio(this.#fetch, provider, network, this.#velcroUrl)
      )
    }

    return this.#verificationPortfolioLibs.get(key)!
  }

  /**
   * Cryptographically verify an already-fetched RPC portfolio result against Colibri.
   *
   * This runs off the portfolio's critical path (the balances are already shown
   * by the time this is called). Because Colibri can prove state for any block up
   * to its head, we verify at the exact block the RPC used (`rpcResult.blockNumber`)
   * instead of coordinating a shared block before fetching. The head gap only
   * decides whether a fresh, comparable result is possible at all:
   * - RPC far behind Colibri -> `stale` (the shown balances are old)
   * - Colibri far behind the RPC -> `warning` (cannot verify)
   * - Colibri slightly behind the RPC -> wait briefly for Colibri to catch up,
   *   then verify or report a warning
   */
  async verifyPortfolio(params: VerifyPortfolioParams): Promise<PortfolioVerification> {
    const { account, network, rpcResult, getOptions, tokenDataCache } = params
    const rpcBlockNumber = BigInt(rpcResult.blockNumber)
    const updatedAt = Date.now()

    const provider = this.getReadyProvider(network.chainId)
    if (!provider) {
      return {
        provider: 'colibri',
        status: 'warning',
        error: 'Colibri verifier is not ready',
        updatedAt
      }
    }

    const blockDiffThreshold =
      network.chainId === 1n
        ? ETHEREUM_COLIBRI_BLOCK_DIFF_THRESHOLD
        : DEFAULT_COLIBRI_BLOCK_DIFF_THRESHOLD

    let verificationBlockNumber = 0n
    try {
      for (let retry = 0; retry <= COLIBRI_CATCH_UP_RETRIES; retry += 1) {
        verificationBlockNumber = BigInt(await provider.getBlockNumber())

        if (verificationBlockNumber >= rpcResult.blockNumber) break

        const blockDiff = rpcBlockNumber - verificationBlockNumber
        if (blockDiff > blockDiffThreshold) break
        if (retry === COLIBRI_CATCH_UP_RETRIES) break

        await wait(COLIBRI_CATCH_UP_RETRY_INTERVAL)
      }
    } catch (error: any) {
      this.emitError({
        level: 'silent',
        message: `Error while resolving the Colibri head block on ${network.name} (${network.chainId}).`,
        error
      })

      return {
        provider: 'colibri',
        status: 'warning',
        error: 'Colibri could not resolve its latest block',
        updatedAt
      }
    }

    const blockDiff = Math.abs(Number(rpcBlockNumber - verificationBlockNumber))

    if (rpcBlockNumber < verificationBlockNumber && blockDiff > blockDiffThreshold) {
      return { provider: 'colibri', status: 'stale', blockDiff, updatedAt }
    }

    if (verificationBlockNumber < rpcBlockNumber) {
      return {
        provider: 'colibri',
        status: 'warning',
        error: `Colibri is ${blockDiff} blocks behind the RPC latest block`,
        updatedAt
      }
    }

    const portfolioLib = this.#getVerificationPortfolioLib(account, network, provider)

    let verifiedResult: PortfolioLibGetResult
    try {
      verifiedResult = await portfolioLib.get(account.addr, {
        ...getOptions,
        tokenDataCache: new Map(tokenDataCache),
        blockTag: Number(rpcBlockNumber),
        disableAutoDiscovery: true
      })
    } catch (error: any) {
      this.emitError({
        level: 'silent',
        message: `Error while verifying portfolio through Colibri on ${network.name} (${network.chainId}).`,
        error
      })

      return {
        provider: 'colibri',
        status: 'warning',
        error: 'Colibri could not verify portfolio balances',
        updatedAt
      }
    }

    return this.#comparePortfolioBalances(rpcResult, verifiedResult)
  }

  #comparePortfolioBalances(
    rpcResult: PortfolioLibGetResult,
    verifiedResult: PortfolioLibGetResult
  ): PortfolioVerification {
    const updatedAt = Date.now()
    const rpcTokenAmounts = new Map(
      rpcResult.tokens.map((token) => [
        token.address.toLowerCase(),
        token.latestAmount ?? token.amount
      ])
    )
    const verifiedTokenAmounts = new Map(
      verifiedResult.tokens.map((token) => [token.address.toLowerCase(), token.amount])
    )
    const mismatches: string[] = []

    rpcTokenAmounts.forEach((rpcAmount, address) => {
      const verifiedAmount = verifiedTokenAmounts.get(address) ?? 0n
      if (rpcAmount !== verifiedAmount) mismatches.push(address)
    })

    verifiedTokenAmounts.forEach((verifiedAmount, address) => {
      if (!rpcTokenAmounts.has(address) && verifiedAmount !== 0n) mismatches.push(address)
    })

    if (mismatches.length) {
      return {
        provider: 'colibri',
        status: 'warning',
        error: `${mismatches.length} balance(s) differed from the Colibri verified result`,
        updatedAt
      }
    }

    return { provider: 'colibri', status: 'success', updatedAt }
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
