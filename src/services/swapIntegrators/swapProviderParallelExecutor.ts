import {
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeRouteStatus,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeSupportedChain,
  SwapAndBridgeToToken,
  SwapProvider
} from '../../interfaces/swapAndBridge'
import { TokenResult } from '../../libs/portfolio'

export class SwapProviderParallelExecutor {
  id: string = 'parallel'

  isHealthy: boolean | null = null

  #providers: SwapProvider[]

  constructor(providers: SwapProvider[]) {
    this.#providers = providers
  }

  /**
   * In the dual setup, we're not using the health feature as
   * we're hoping that at least one provider is going to work at all times
   */
  updateHealth() {
    this.isHealthy = null
  }

  resetHealth() {
    this.isHealthy = null
  }

  async #fetchFromAll<T>(fetchMethod: (provider: SwapProvider) => Promise<T | Error>): Promise<T> {
    const apiResponses = await Promise.all(this.#providers.map(fetchMethod))
    const resultsWithoutErrors = apiResponses.filter((r) => !(r instanceof Error))
    if (!resultsWithoutErrors.length) {
      throw new Error('Swap providers are currently not working. Please try again later')
    }

    return resultsWithoutErrors.flat() as T
  }

  async #routeTo<T, M extends keyof SwapProvider>(
    providerId: string,
    method: M,
    ...args: any
  ): Promise<T> {
    const provider = this.#providers.find((p) => p.id === providerId)
    if (!provider) throw new Error('Swap provider misconfiguration')
    return (provider[method] as any)(...args)
  }

  async getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]> {
    const chainIds = await this.#fetchFromAll<SwapAndBridgeSupportedChain[]>(
      (provider: SwapProvider) => provider.getSupportedChains().catch((e) => e)
    )

    // filter duplicates
    return [
      ...new Map(chainIds.map((item: SwapAndBridgeSupportedChain) => [item.chainId, item])).values()
    ]
  }

  async getToTokenList({
    fromChainId,
    toChainId
  }: {
    fromChainId: number
    toChainId: number
  }): Promise<SwapAndBridgeToToken[]> {
    const toTokenList = await this.#fetchFromAll<SwapAndBridgeToToken[]>((provider: SwapProvider) =>
      provider.getToTokenList({ fromChainId, toChainId }).catch((e) => e)
    )

    // filter duplicates
    return [
      ...new Map(
        toTokenList.map((item: SwapAndBridgeToToken) => [`${item.chainId}-${item.address}`, item])
      ).values()
    ]
  }

  async getToken({
    address,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<SwapAndBridgeToToken | null> {
    const toTokens = await this.#fetchFromAll<SwapAndBridgeToToken[] | null[]>(
      (provider: SwapProvider) => provider.getToken({ address, chainId }).catch((e) => e)
    )
    return toTokens.find((t) => t) || null
  }

  async startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest> {
    return this.#routeTo(route.providerId, 'startRoute', route)
  }

  async quote({
    fromAsset,
    fromChainId,
    fromTokenAddress,
    toAsset,
    toChainId,
    toTokenAddress,
    fromAmount,
    userAddress,
    sort,
    isOG,
    accountNativeBalance,
    nativeSymbol
  }: {
    fromAsset: TokenResult | null
    fromChainId: number
    fromTokenAddress: string
    toAsset: SwapAndBridgeToToken | null
    toChainId: number
    toTokenAddress: string
    fromAmount: bigint
    userAddress: string
    isSmartAccount: boolean
    sort: 'time' | 'output'
    isOG: boolean
    accountNativeBalance: bigint
    nativeSymbol: string
  }): Promise<SwapAndBridgeQuote> {
    const quotes = await this.#fetchFromAll<SwapAndBridgeQuote[]>((provider: SwapProvider) =>
      provider
        .quote({
          fromAsset,
          fromChainId,
          fromTokenAddress,
          toAsset,
          toChainId,
          toTokenAddress,
          fromAmount,
          userAddress,
          sort,
          isOG,
          accountNativeBalance,
          nativeSymbol
        })
        .catch((e) => e)
    )
    const firstQuote = quotes[0]
    return {
      ...firstQuote,
      routes: quotes.map((q) => q.routes.flat()).flat()
    }
  }

  getRouteStatus({
    txHash,
    fromChainId,
    toChainId,
    bridge,
    providerId
  }: {
    txHash: string
    fromChainId: number
    toChainId: number
    bridge?: string
    providerId: string
  }): Promise<SwapAndBridgeRouteStatus> {
    return this.#routeTo(providerId, 'getRouteStatus', { txHash, fromChainId, toChainId, bridge })
  }
}
