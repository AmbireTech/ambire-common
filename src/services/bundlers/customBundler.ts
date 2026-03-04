/* eslint-disable class-methods-use-this */

import { BUNDLER, CUSTOM } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { getViemGasPrices } from '../../libs/gasPrice/gasPrice'
import { Bundler } from './bundler'
import { GasSpeeds, UserOpStatus } from './types'

export class CustomBundler extends Bundler {
  protected getUrl(network: Network): string {
    if (!network.customBundlerUrl) throw new Error('custom bundler not set')
    return network.customBundlerUrl
  }

  protected async getGasPrice(network: Network): Promise<GasSpeeds> {
    return getViemGasPrices(network)
  }

  public async getStatus(network: Network, userOpHash: string): Promise<UserOpStatus> {
    const provider = this.getProvider(network)

    const status = await provider.send('eth_getUserOperationReceipt', [userOpHash]).catch((e) => {
      // eslint-disable-next-line no-console
      console.log(
        `custom bundler with url ${this.getUrl(network)} failed to find the status of the user op`
      )
      // eslint-disable-next-line no-console
      console.log(e)

      return null
    })

    if (!status || !status.receipt) {
      return {
        status: 'not_found'
      }
    }

    return {
      status: 'found',
      transactionHash: status.receipt.transactionHash
    }
  }

  public getName(): BUNDLER {
    return CUSTOM
  }

  public shouldReestimateBeforeBroadcast(): boolean {
    return true
  }
}
