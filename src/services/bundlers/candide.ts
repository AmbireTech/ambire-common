/* eslint-disable class-methods-use-this */
/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { toBeHex } from 'ethers'
import { BUNDLER, CANDIDE } from '../../consts/bundlers'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { BundlerEstimateResult, BundlerStateOverride } from '../../libs/estimate/interfaces'
import { UserOperation } from '../../libs/userOperation/types'
import { Bundler } from './bundler'
import { GasSpeeds, UserOpStatus } from './types'

export class Candide extends Bundler {
  protected getUrl(network: Network): string {
    if (network.chainId === 42220n) {
      return `https://api.candide.dev/bundler/v3/celo/${process.env.REACT_APP_CANDIDE_API_KEY}`
    }

    return `https://api.candide.dev/bundler/v3/ethereum/${process.env.REACT_APP_CANDIDE_API_KEY}`
  }

  protected async getGasPrice(network: Network): Promise<GasSpeeds> {
    const provider = this.getProvider(network)
    const prices: any = await provider.send('voltaire_feesPerGas', [])

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

  async estimate(
    userOperation: UserOperation,
    network: Network,
    stateOverride?: BundlerStateOverride
  ): Promise<BundlerEstimateResult> {
    const estimatiton = await this.sendEstimateReq(userOperation, network, stateOverride)

    return {
      // add 20000n overhead as discussed with candide
      preVerificationGas: toBeHex(BigInt(estimatiton.preVerificationGas) + 20000n) as Hex,
      verificationGasLimit: toBeHex(BigInt(estimatiton.verificationGasLimit) + 20000n) as Hex,
      callGasLimit: toBeHex(estimatiton.callGasLimit) as Hex,
      paymasterVerificationGasLimit: estimatiton.paymasterVerificationGasLimit
        ? (toBeHex(estimatiton.paymasterVerificationGasLimit) as Hex)
        : '0x00',
      paymasterPostOpGasLimit: estimatiton.paymasterPostOpGasLimit
        ? (toBeHex(estimatiton.paymasterPostOpGasLimit) as Hex)
        : '0x00'
    }
  }

  public getName(): BUNDLER {
    return CANDIDE
  }

  public shouldReestimateBeforeBroadcast(network: Network): boolean {
    return true
  }
}
