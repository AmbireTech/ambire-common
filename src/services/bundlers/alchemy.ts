/* eslint-disable class-methods-use-this */

import { toBeHex } from 'ethers'

import { ALCHEMY, BUNDLER } from '../../consts/bundlers'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { getViemGasPrices } from '../../libs/gasPrice/gasPrice'
import { Bundler } from './bundler'
import { GasSpeeds, UserOpStatus } from './types'

export class Alchemy extends Bundler {
  protected getUrl(network: Network): string {
    const API_KEY = process.env.REACT_APP_ALCHEMY_BUNDLER_API_KEY || ''

    if (!API_KEY) {
      throw new Error('Alchemy API key is not set')
    }

    if (network.chainId === 1n) {
      return `https://eth-mainnet.g.alchemy.com/v2/${API_KEY}`
    }

    if (network.chainId === 10n) {
      return `https://opt-mainnet.g.alchemy.com/v2/${API_KEY}`
    }

    throw new Error(`${network.name} not enabled for alchemy`)
  }

  protected async getGasPrice(network: Network): Promise<GasSpeeds> {
    const provider = this.getProvider(network)
    const [viemPrices, bundlerMaxPriorityFee] = await Promise.all([
      getViemGasPrices(network),
      provider.send('rundler_maxPriorityFeePerGas', [])
    ])
    return {
      slow: {
        maxFeePerGas: toBeHex(
          BigInt(viemPrices.slow.maxFeePerGas) -
            BigInt(viemPrices.slow.maxPriorityFeePerGas) +
            BigInt(bundlerMaxPriorityFee)
        ) as Hex,
        maxPriorityFeePerGas: bundlerMaxPriorityFee
      },
      medium: {
        maxFeePerGas: toBeHex(
          BigInt(viemPrices.medium.maxFeePerGas) -
            BigInt(viemPrices.medium.maxPriorityFeePerGas) +
            BigInt(bundlerMaxPriorityFee)
        ) as Hex,
        maxPriorityFeePerGas: bundlerMaxPriorityFee
      },
      fast: {
        maxFeePerGas: toBeHex(
          BigInt(viemPrices.fast.maxFeePerGas) -
            BigInt(viemPrices.fast.maxPriorityFeePerGas) +
            BigInt(bundlerMaxPriorityFee)
        ) as Hex,
        maxPriorityFeePerGas: bundlerMaxPriorityFee
      },
      ape: {
        maxFeePerGas: toBeHex(
          BigInt(viemPrices.ape.maxFeePerGas) -
            BigInt(viemPrices.ape.maxPriorityFeePerGas) +
            BigInt(bundlerMaxPriorityFee)
        ) as Hex,
        maxPriorityFeePerGas: bundlerMaxPriorityFee
      }
    }
  }

  public async getStatus(network: Network, userOpHash: string): Promise<UserOpStatus> {
    const provider = this.getProvider(network)

    const status = await provider.send('eth_getUserOperationReceipt', [userOpHash]).catch((e) => {
      // eslint-disable-next-line no-console
      console.log(`alchemy bundler failed to find the status of the user op`)
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
    return ALCHEMY
  }

  public shouldReestimateBeforeBroadcast(): boolean {
    return false
  }
}
