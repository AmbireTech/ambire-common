import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import {
  ProviderQuoteParams,
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeRouteStatus,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeSupportedChain,
  SwapAndBridgeToToken,
  SwapProvider
} from '../../interfaces/swapAndBridge'
import wait from '../../utils/wait'

export class SwapProviderParallelExecutor {
  id: string = 'parallel'

  name = 'Parallel'

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

  async #fetchFromAll<T>(
    fetchMethod: (provider: SwapProvider) => Promise<T | Error>,
    reqMeta?: {
      chainIds?: number[]
    }
  ): Promise<T> {
    const { chainIds = [] } = reqMeta || {}
    const uniqueChainIds = [...new Set(chainIds)]
    const MIN_WAIT = 3000 // 3s
    const MAX_WAIT_AFTER_FIRST_COMPLETED = 2000 // 2s
    const MAX_ABSOLUTE_WAIT_FOR_ALL_TO_COMPLETE = 15000 // 15s

    const results: { provider: SwapProvider; result: T | Error }[] = []

    const startTime = Date.now()

    const tasks = this.#providers
      .filter((provider) => {
        // If the request is not chainId specific, use all providers
        if (!uniqueChainIds.length) return true
        // If supportedChains is not set yet, we just try to use the provider
        if (provider.supportedChains === null) return true
        const supportedChainIds = provider.supportedChains.map(({ chainId }) => chainId)

        const res = uniqueChainIds.every((chainId) => supportedChainIds?.includes(chainId))

        return res
      })
      .map((provider) =>
        fetchMethod(provider)
          .then((result) => ({ provider, result }))
          .catch((err) => ({ provider, result: err as Error }))
      )

    if (!tasks.length) {
      throw new SwapAndBridgeProviderApiError('Unsupported network')
    }

    const absoluteTimeout = wait(MAX_ABSOLUTE_WAIT_FOR_ALL_TO_COMPLETE).then(() => {
      throw new Error(
        'Our service providers are temporarily unavailable or your internet connection is too slow.'
      )
    })

    const firstResult = await Promise.race([Promise.any(tasks), absoluteTimeout])

    if ('provider' in firstResult && 'result' in firstResult) {
      results.push(firstResult)
    }

    const remainingTasks = this.#providers
      // Make sure the provider was not filtered out
      .filter((p) => !results.some((r) => r.provider === p) && !!tasks[this.#providers.indexOf(p)])
      .map((provider) => {
        const originalIdx = this.#providers.indexOf(provider)
        return tasks[originalIdx]
          .then((res) => res)
          .catch((err) => ({ provider, result: err as Error }))
      })

    // Figure out how long we've already waited
    const elapsed = Date.now() - startTime
    // If first was too quick, extend wait time so total ≥ MIN_WAIT
    const remainingMinWait = Math.max(0, MIN_WAIT - elapsed)

    const secondResult = (await Promise.race([
      // Promise.any can't be called with an empty array
      remainingTasks.length ? Promise.any(remainingTasks) : Promise.resolve(),
      wait(MAX_WAIT_AFTER_FIRST_COMPLETED + remainingMinWait)
    ])) as { provider: SwapProvider; result: Error | T }

    if (secondResult) {
      if ('provider' in secondResult && 'result' in secondResult) {
        results.push(secondResult)
      }
    }

    const valid = results.map((r) => r.result).filter((r) => !(r instanceof Error))
    if (valid.length > 0) return valid.flat() as T

    const errors = results.map((r) => r.result).filter((r): r is Error => r instanceof Error)
    if (!errors.length) {
      throw new SwapAndBridgeProviderApiError(
        'Our service providers are currently unavailable. Please try again later.'
      )
    }

    // Use the first error (LiFi) as base message, since the bet is that's the the most accurate
    const baseMessage = errors[0].message || 'Unknown error'

    // Extract technical details from all errors (that's the content between < and >)
    const technicalDetails = errors
      .map((error) => {
        const message = error.message || ''
        const match = message.match(/<([^>]+)>/)
        return match ? match[1] : null
      })
      .filter(Boolean)

    // Modify the base message to indicate multiple providers
    const providerNames = this.#providers.map((p) => p.name).join(' and ')
    let combinedMessage = baseMessage
      .replace(/\bLiFi\b/g, providerNames)
      .replace(/\bservice provider\b/g, 'service providers')
      .replace(/\bis temporarily unavailable\b/g, 'are temporarily unavailable')

    // Replace the technical details with combined ones
    if (technicalDetails.length > 0) {
      const combinedDetails = technicalDetails.join('> and <')
      combinedMessage = combinedMessage.replace(/<[^>]+>/, `<${combinedDetails}>`)
    }

    throw new SwapAndBridgeProviderApiError(combinedMessage)
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
    const toTokenList = await this.#fetchFromAll<SwapAndBridgeToToken[]>(
      (provider: SwapProvider) =>
        provider.getToTokenList({ fromChainId, toChainId }).catch((e) => e),
      { chainIds: [fromChainId, toChainId] }
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
      (provider: SwapProvider) => provider.getToken({ address, chainId }).catch((e) => e),
      { chainIds: [chainId] }
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
    nativeSymbol,
    isWrapOrUnwrap
  }: ProviderQuoteParams): Promise<SwapAndBridgeQuote> {
    const quotes = await this.#fetchFromAll<SwapAndBridgeQuote[]>(
      (provider: SwapProvider) =>
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
            nativeSymbol,
            isWrapOrUnwrap
          })
          .catch((e) => e),
      { chainIds: [fromChainId, toChainId] }
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
