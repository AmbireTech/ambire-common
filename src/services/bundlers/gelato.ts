/* eslint-disable class-methods-use-this */
/* eslint-disable no-console */
import { BUNDLER, GELATO } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
/* eslint-disable @typescript-eslint/no-unused-vars */
import { BundlerEstimateResult, BundlerStateOverride } from '../../libs/estimate/interfaces'
import { UserOperation } from '../../libs/userOperation/types'
import { getRpcProvider } from '../provider'
import { Bundler } from './bundler'
import { GasSpeeds, UserOpStatus } from './types'

export class Gelato extends Bundler {
  protected getUrl(network: Network): string {
    return `https://api.gelato.cloud/rpc/${network.chainId.toString()}`
  }

  /**
   * Get the bundler RPC
   *
   * @param network
   */
  protected getProvider(network: Network): RPCProvider {
    const provider = getRpcProvider([this.getUrl(network)], network.chainId)

    const gelatoSend = async (method: string, params: Array<any> | Record<string, any>) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      const response = await fetch(this.getUrl(network), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.REACT_APP_GELATO_API_KEY!
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Bundler request failed')
      }

      const json = await response.json()
      if (json.error) throw new Error(json.error.message || 'Bundler request failed')
      return json.result
    }

    provider.send = gelatoSend
    return provider
  }

  protected async getGasPrice(network: Network): Promise<GasSpeeds> {
    const provider = this.getProvider(network)
    const prices: any = await provider.send('gelato_getUserOperationGasPrice', [])

    // do not set a priority of 0
    const priority = prices.maxPriorityFeePerGas === '0x0' ? '0x1' : prices.maxPriorityFeePerGas
    return {
      slow: {
        maxFeePerGas: prices.maxFeePerGas,
        maxPriorityFeePerGas: priority
      },
      medium: {
        maxFeePerGas: prices.maxFeePerGas,
        maxPriorityFeePerGas: priority
      },
      fast: {
        maxFeePerGas: prices.maxFeePerGas,
        maxPriorityFeePerGas: priority
      },
      ape: {
        maxFeePerGas: prices.maxFeePerGas,
        maxPriorityFeePerGas: priority
      }
    }
  }

  async estimate(
    userOperation: UserOperation,
    network: Network,
    stateOverride?: BundlerStateOverride
  ): Promise<BundlerEstimateResult> {
    const estimatiton = await this.sendEstimateReq(userOperation, network, stateOverride)

    return {
      preVerificationGas: estimatiton.preVerificationGas,
      verificationGasLimit: estimatiton.verificationGasLimit,
      callGasLimit: estimatiton.callGasLimit,
      paymasterVerificationGasLimit: estimatiton.paymasterVerificationGasLimit
        ? estimatiton.paymasterVerificationGasLimit
        : '0x0',
      paymasterPostOpGasLimit: estimatiton.paymasterPostOpGasLimit
        ? estimatiton.paymasterPostOpGasLimit
        : '0x0'
    }
  }

  public async getStatus(network: Network, userOpHash: string): Promise<UserOpStatus> {
    const provider = this.getProvider(network)

    const status = await provider.send('eth_getUserOperationReceipt', [userOpHash]).catch((e) => {
      // eslint-disable-next-line no-console
      console.log('gelato failed to find the status of the user op')
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
    return GELATO
  }

  public shouldReestimateBeforeBroadcast(network: Network): boolean {
    return true
  }
}
