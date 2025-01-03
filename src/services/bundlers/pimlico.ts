/* eslint-disable class-methods-use-this */
import { Network } from 'interfaces/network'

import { Bundler } from './bundler'
import { GasSpeeds } from './types'

export class Pimlico extends Bundler {
  protected getUrl(network: Network): string {
    return `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
  }

  protected async getGasPrice(network: Network): Promise<GasSpeeds> {
    const provider = this.getProvider(network)
    const prices: any = await provider.send('pimlico_getUserOperationGasPrice', [])
    prices.medium = prices.standard
    prices.ape = prices.fast
    delete prices.standard
    return prices
  }
}
