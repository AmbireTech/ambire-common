/* eslint-disable class-methods-use-this */

import { toBeHex } from 'ethers'
import { createPublicClient, defineChain, http } from 'viem'
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
    const chain = defineChain({
      id: Number(network.chainId),
      name: network.name,
      nativeCurrency: {
        name: network.nativeAssetId,
        symbol: network.nativeAssetSymbol,
        decimals: 18
      },
      rpcUrls: {
        default: {
          http: [network.selectedRpcUrl]
        },
        public: {
          http: [network.selectedRpcUrl]
        }
      },
      blockExplorers: {
        default: {
          name: 'Block explorer',
          url: network.explorerUrl
        }
      }
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

  /**
   * For the time being, we're not supporting custom bundler URLs
   * as we need to handle this on the relayer side and there might
   * be overcomplications, having also legends in mind.
   * The custom bundler URL is more for devs to experiment and
   * it's okay to skip paymaster support
   */
  supportsAmbirePaymaster() {
    return false
  }
}
