/* eslint-disable class-methods-use-this */
/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { parseUnits, toBeHex } from 'ethers'
import { BUNDLER, CANDIDE } from '../../consts/bundlers'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { BundlerEstimateResult, BundlerStateOverride } from '../../libs/estimate/interfaces'
import { getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { UserOperation } from '../../libs/userOperation/types'
import { Bundler } from './bundler'
import { GasSpeeds, UserOpStatus } from './types'

export class Candide extends Bundler {
  protected getUrl(network: Network): string {
    let candideNetworkName

    switch (network.chainId.toString()) {
      case '1':
        candideNetworkName = 'ethereum'
        break

      case '10':
        candideNetworkName = 'optimism'
        break

      case '56':
        candideNetworkName = 'bsc'
        break

      case '100':
        candideNetworkName = 'gnosis'
        break

      case '137':
        candideNetworkName = 'polygon'
        break

      case '480':
        candideNetworkName = 'worldchain'
        break

      case '8453':
        candideNetworkName = 'base'
        break

      case '42161':
        candideNetworkName = 'arbitrum'
        break

      case '42220':
        candideNetworkName = 'celo'
        break

      default:
        break
    }

    return `https://api.candide.dev/bundler/v3/${candideNetworkName}/${process.env.REACT_APP_CANDIDE_API_KEY}`
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
      console.log('candide eth_getUserOperationByHash returned an error')
      console.log(e)

      return null
    })

    if (!status || 'error' in status) {
      return {
        status: 'rejected'
      }
    }

    if (!status.transactionHash) {
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

  async estimate(
    userOperation: UserOperation,
    network: Network,
    stateOverride?: BundlerStateOverride
  ): Promise<BundlerEstimateResult> {
    const estimatiton = await this.sendEstimateReq(userOperation, network, stateOverride)
    const addedPreVerGas = network.isOptimistic ? 50000n : 0n

    return {
      preVerificationGas: toBeHex(BigInt(estimatiton.preVerificationGas) + addedPreVerGas) as Hex,
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
}
