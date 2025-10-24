/* eslint-disable class-methods-use-this */

import { toBeHex } from 'ethers'
import { createPublicClient, extractChain, http } from 'viem'
import * as builtins from 'viem/chains'
import { BUNDLER, CUSTOM } from '../../consts/bundlers'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { Bundler } from './bundler'
import { GasSpeeds, UserOpStatus } from './types'

export class CustomBundler extends Bundler {
  protected getUrl(network: Network): string {
    if (!network.customBundlerUrl) throw new Error('custom bundler not set')
    return network.customBundlerUrl
  }

  protected async getGasPrice(network: Network): Promise<GasSpeeds> {
    const chain = extractChain({
      chains: builtins as any,
      id: Number(network.chainId)
    })
    const client = createPublicClient({
      chain,
      transport: http()
    })
    const data = await client.estimateFeesPerGas()
    return {
      slow: {
        maxFeePerGas: toBeHex(data.maxFeePerGas) as Hex,
        maxPriorityFeePerGas: toBeHex(data.maxPriorityFeePerGas) as Hex
      },
      medium: {
        maxFeePerGas: toBeHex(data.maxFeePerGas) as Hex,
        maxPriorityFeePerGas: toBeHex(data.maxPriorityFeePerGas) as Hex
      },
      fast: {
        maxFeePerGas: toBeHex(data.maxFeePerGas) as Hex,
        maxPriorityFeePerGas: toBeHex(data.maxPriorityFeePerGas) as Hex
      },
      ape: {
        maxFeePerGas: toBeHex(data.maxFeePerGas) as Hex,
        maxPriorityFeePerGas: toBeHex(data.maxPriorityFeePerGas) as Hex
      }
    }
  }

  public async getStatus(network: Network, userOpHash: string): Promise<UserOpStatus> {
    const provider = this.getProvider(network)

    const status = await provider.send('eth_getUserOperationByHash', [userOpHash]).catch((e) => {
      console.log(
        `custom bundler with url ${this.getUrl(network)} failed to find the status of the user op`
      )
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
    return CUSTOM
  }

  public shouldReestimateBeforeBroadcast(): boolean {
    return true
  }
}
