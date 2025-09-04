import { SwapAndBridgeSupportedChain, SwapProvider } from '../../interfaces/swapAndBridge'

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

  async getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]> {
    const apiResponses = await Promise.all(
      this.#providers.map((provider) => provider.getSupportedChains().catch((e) => e))
    )
    const resultsWithoutErrors = apiResponses.filter((r) => !(r instanceof Error))
    if (!resultsWithoutErrors.length) {
      throw new Error('Swap providers are currently not working. Please try again later')
    }

    return [
      ...new Map(
        resultsWithoutErrors.flat().map((item: SwapAndBridgeSupportedChain) => [item.chainId, item])
      ).values()
    ]
  }
}
