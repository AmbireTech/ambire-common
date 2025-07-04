/* eslint-disable class-methods-use-this */
/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { parseUnits, toBeHex } from 'ethers'
import { BUNDLER, GELATO } from '../../consts/bundlers'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { Bundler } from './bundler'
import { GasSpeeds, UserOpStatus } from './types'

export class Gelato extends Bundler {
  protected getUrl(network: Network): string {
    return `https://api.gelato.digital/bundlers/${network.chainId.toString()}/rpc?sponsorApiKey=${
      process.env.REACT_APP_GELATO_API_KEY
    }`
  }

  protected async getGasPrice(network: Network, provider: RPCProvider): Promise<GasSpeeds> {
    const gasPrices = await getGasPriceRecommendations(provider, network)

    const gasSpeeds: GasSpeeds = {
      slow: { maxFeePerGas: '0x00', maxPriorityFeePerGas: '0x00' },
      medium: { maxFeePerGas: '0x00', maxPriorityFeePerGas: '0x00' },
      fast: { maxFeePerGas: '0x00', maxPriorityFeePerGas: '0x00' },
      ape: { maxFeePerGas: '0x00', maxPriorityFeePerGas: '0x00' }
    }

    gasPrices.gasPrice.forEach((entry, i) => {
      const speed = entry.name as 'slow' | 'medium' | 'fast' | 'ape'

      if ('gasPrice' in entry) {
        gasSpeeds[speed].maxFeePerGas = toBeHex(entry.gasPrice) as Hex
        gasSpeeds[speed].maxPriorityFeePerGas = toBeHex(parseUnits('2', 'gwei')) as Hex
      } else {
        gasSpeeds[speed].maxFeePerGas = toBeHex(
          entry.baseFeePerGas + entry.maxPriorityFeePerGas
        ) as Hex
        gasSpeeds[speed].maxPriorityFeePerGas = toBeHex(entry.maxPriorityFeePerGas) as Hex
      }
    })

    return gasSpeeds
  }

  public async getStatus(network: Network, userOpHash: string): Promise<UserOpStatus> {
    const provider = this.getProvider(network)

    const status = await provider.send('eth_getUserOperationByHash', [userOpHash]).catch((e) => {
      console.log('gelato eth_getUserOperationByHash returned an error')
      console.log(e)

      return null
    })

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
    return GELATO
  }
}
