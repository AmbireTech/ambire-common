import { RPCProvider } from '@/interfaces/provider'
import { getRpcProvider } from '@/services/provider'

import { BUNDLER, PIMLICO } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { Bundler } from './bundler'
import { GasSpeeds, UserOpStatus } from './types'

export class Pimlico extends Bundler {
  protected getUrl(network: Network): string {
    const API_KEY = process.env.REACT_APP_PIMLICO_API_KEY || ''

    if (!API_KEY) {
      throw new Error('Pimlico API key is not set')
    }

    return `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${API_KEY}`
  }

  /**
   * Pimlico has a second API url used for fallback purposes that skips
   * cloudflare. We will use it as a fallback to retry automatically
   * when the original URL fails
   */
  protected getFallbackProvider(network: Network): RPCProvider {
    const API_KEY = process.env.REACT_APP_PIMLICO_API_KEY || ''

    if (!API_KEY) {
      throw new Error('Pimlico API key is not set')
    }

    const url = `https://api-direct.pimlico.io/v2/${network.chainId}/rpc?apikey=${API_KEY}`
    return getRpcProvider([url], network.chainId)
  }

  protected async getGasPrice(network: Network): Promise<GasSpeeds> {
    const provider = this.getProvider(network)

    // try main URL; retry with fallback on failure
    let prices: any
    try {
      prices = await provider.send('pimlico_getUserOperationGasPrice', [])
    } catch (e) {
      console.log('fallback to api-direct')
      const fallbackProvider = this.getFallbackProvider(network)
      prices = await fallbackProvider.send('pimlico_getUserOperationGasPrice', [])
    }

    prices.medium = prices.standard
    prices.ape = prices.fast
    delete prices.standard
    return prices
  }

  public async getStatus(network: Network, userOpHash: string): Promise<UserOpStatus> {
    const provider = this.getProvider(network)
    return provider.send('pimlico_getUserOperationStatus', [userOpHash])
  }

  public getName(): BUNDLER {
    return PIMLICO
  }

  public shouldReestimateBeforeBroadcast(): boolean {
    return false
  }
}
