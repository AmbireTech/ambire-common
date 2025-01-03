/* eslint-disable class-methods-use-this */
import { Network } from 'interfaces/network'

import { Bundler } from './bundler'

export class Biconomy extends Bundler {
  protected getUrl(network: Network): string {
    return `https://bundler.biconomy.io/api/v3/${network.chainId}/nJPK7B3ru.dd7f7861-190d-41bd-af80-6877f74b8f44`
  }
}
