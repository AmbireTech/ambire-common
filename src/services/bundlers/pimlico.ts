/* eslint-disable class-methods-use-this */
import { Network } from 'interfaces/network'

import { Bundler } from './bundler'

export class Pimlico extends Bundler {
  protected getUrl(network: Network): string {
    return `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
  }
}
