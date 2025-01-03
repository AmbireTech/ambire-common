/* eslint-disable class-methods-use-this */
import { Network } from 'interfaces/network'

import { Bundler } from './bundler'
import { GasSpeeds } from './types'

export class Biconomy extends Bundler {
  protected getUrl(network: Network): string {
    return `https://bundler.biconomy.io/api/v3/${network.chainId}/nJPK7B3ru.dd7f7861-190d-41bd-af80-6877f74b8f44`
  }

  protected async getGasPrice(network: Network): Promise<GasSpeeds> {
    const provider = this.getProvider(network)
    const prices: any = await provider.send('biconomy_getGasFeeValues', [])

    // biconomy returns only single values for maxFeePerGas
    return {
      slow: {
        maxFeePerGas: prices.maxFeePerGas,
        maxPriorityFeePerGas: prices.maxPriorityFeePerGas
      },
      medium: {
        maxFeePerGas: prices.maxFeePerGas,
        maxPriorityFeePerGas: prices.maxPriorityFeePerGas
      },
      fast: {
        maxFeePerGas: prices.maxFeePerGas,
        maxPriorityFeePerGas: prices.maxPriorityFeePerGas
      },
      ape: {
        maxFeePerGas: prices.maxFeePerGas,
        maxPriorityFeePerGas: prices.maxPriorityFeePerGas
      }
    }
  }
}
