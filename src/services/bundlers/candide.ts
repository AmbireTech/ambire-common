/* eslint-disable class-methods-use-this */
/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { BUNDLER, CANDIDE } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { Bundler } from './bundler'
import { GasSpeeds, UserOpStatus } from './types'

export class Candide extends Bundler {
  protected getUrl(network: Network): string {
    return `https://api.candide.dev/bundler/v3/ethereum/${process.env.REACT_APP_CANDIDE_API_KEY}`
  }

  protected async getGasPrice(network: Network): Promise<GasSpeeds> {
    const provider = this.getProvider(network)
    const prices: any = await provider.send('voltaire_feesPerGas', [])
    console.log('voltaire prices', prices)

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

  public async getStatus(network: Network, userOpHash: string): Promise<UserOpStatus> {
    const provider = this.getProvider(network)

    const status = await provider.send('eth_getUserOperationByHash', [userOpHash]).catch((e) => {
      console.log('candide eth_getUserOperationByHash returned an error')
      console.log(e)

      return null
    })

    console.log('the status of the user op', status)

    if (!status) {
      return {
        status: 'not_found'
      }
    }

    return {
      status: 'found',
      transactionHash: status.transactionHash
    }
  }

  public getName(): BUNDLER {
    return CANDIDE
  }

  public shouldReestimateBeforeBroadcast(network: Network): boolean {
    return false
  }
}
