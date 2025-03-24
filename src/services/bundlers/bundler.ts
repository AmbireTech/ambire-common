/* eslint-disable no-restricted-syntax */
/* eslint-disable class-methods-use-this */
import { toBeHex } from 'ethers'

/* eslint-disable import/no-extraneous-dependencies */
import { BUNDLER } from '../../consts/bundlers'
import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Fetch } from '../../interfaces/fetch'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { decodeError } from '../../libs/errorDecoder'
import { BundlerError } from '../../libs/errorDecoder/customErrors'
import { DecodedError } from '../../libs/errorDecoder/types'
import { BundlerEstimateResult, BundlerStateOverride } from '../../libs/estimate/interfaces'
import { UserOperation } from '../../libs/userOperation/types'
import { getCleanUserOp } from '../../libs/userOperation/userOperation'
import { getRpcProvider } from '../provider'
import { GasSpeeds, UserOpStatus } from './types'

require('dotenv').config()

function addExtra(gasInWei: bigint, percentageIncrease: bigint): Hex {
  const percent = 100n / percentageIncrease
  return toBeHex(gasInWei + gasInWei / percent) as Hex
}

export abstract class Bundler {
  /**
   * The default pollWaitTime. This is used to determine
   * how many milliseconds to wait until before another request to the
   * bundler for the receipt is sent
   */
  public pollWaitTime = 1500

  /**
   * Define the bundler URL
   */
  protected abstract getUrl(network: Network): string

  /**
   * Each bundler has their own gas prices. Define and fetch them
   */
  protected abstract getGasPrice(network: Network): Promise<GasSpeeds>

  /**
   * Each bundler has it's own handler for giving information back
   */
  public abstract getStatus(network: Network, userOpHash: string): Promise<UserOpStatus>

  /**
   * Each bundler needs to return its own na,e
   */
  public abstract getName(): BUNDLER

  /**
   * Get the bundler RPC
   *
   * @param network
   */
  protected getProvider(network: Network): RPCProvider {
    return getRpcProvider([this.getUrl(network)], network.chainId)
  }

  private async sendEstimateReq(
    userOperation: UserOperation,
    network: Network,
    stateOverride?: BundlerStateOverride
  ): Promise<BundlerEstimateResult> {
    const provider = this.getProvider(network)
    return stateOverride
      ? provider.send('eth_estimateUserOperationGas', [
          getCleanUserOp(userOperation)[0],
          ERC_4337_ENTRYPOINT,
          stateOverride
        ])
      : provider.send('eth_estimateUserOperationGas', [
          getCleanUserOp(userOperation)[0],
          ERC_4337_ENTRYPOINT
        ])
  }

  async estimate(
    userOperation: UserOperation,
    network: Network,
    stateOverride?: BundlerStateOverride
  ): Promise<BundlerEstimateResult> {
    const estimatiton = await this.sendEstimateReq(userOperation, network, stateOverride)

    // Whole formula:
    // final = estimation + estimation * percentage
    // if percentage = 5% then percentage = 5/100 => 1/20
    // final = estimation + estimation / 20
    // here, we calculate the division (20 above)
    const division = network.erc4337.increasePreVerGas
      ? BigInt(100 / network.erc4337.increasePreVerGas)
      : undefined

    // transform
    const preVerificationGas = division
      ? BigInt(estimatiton.preVerificationGas) + BigInt(estimatiton.preVerificationGas) / division
      : BigInt(estimatiton.preVerificationGas)

    return {
      preVerificationGas: toBeHex(preVerificationGas) as Hex,
      verificationGasLimit: toBeHex(estimatiton.verificationGasLimit) as Hex,
      callGasLimit: toBeHex(estimatiton.callGasLimit) as Hex,
      paymasterVerificationGasLimit: toBeHex(estimatiton.paymasterVerificationGasLimit) as Hex,
      paymasterPostOpGasLimit: toBeHex(estimatiton.paymasterPostOpGasLimit) as Hex
    }
  }

  /**
   * Get the transaction receipt from the userOperationHash if ready
   *
   * @param userOperationHash
   * @returns Receipt | null
   */
  async getReceipt(userOperationHash: string, network: Network) {
    const provider = this.getProvider(network)
    return provider.send('eth_getUserOperationReceipt', [userOperationHash])
  }

  /**
   * Broadcast a userOperation to the specified bundler and get a userOperationHash in return
   *
   * @param UserOperation userOperation
   * @returns userOperationHash
   */
  async broadcast(userOperation: UserOperation, network: Network): Promise<string> {
    const provider = this.getProvider(network)
    return provider.send('eth_sendUserOperation', [
      getCleanUserOp(userOperation)[0],
      ERC_4337_ENTRYPOINT
    ])
  }

  // use this request to check if the bundler supports the network
  static async isNetworkSupported(fetch: Fetch, chainId: bigint) {
    const url = `https://api.pimlico.io/health?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}&chain-id=${chainId}`
    const result = await fetch(url)
    return result.status === 200
  }

  async fetchGasPrices(
    network: Network,
    errorCallback: Function,
    counter: number = 0
  ): Promise<GasSpeeds> {
    const hasFallback = network.erc4337.bundlers && network.erc4337.bundlers.length > 1
    if (counter >= (hasFallback ? 2 : 5)) throw new Error("Couldn't fetch gas prices")

    let response

    try {
      response = await Promise.race([
        this.getGasPrice(network),
        new Promise((_resolve, reject) => {
          setTimeout(
            () => reject(new Error('fetching bundler gas prices failed, request too slow')),
            hasFallback ? 4500 : 6000
          )
        })
      ])
    } catch (e: any) {
      // report the error back only if there's no fallback
      if (!hasFallback) {
        errorCallback({
          level: 'major',
          message: 'Estimating gas prices from the bundler timed out. Retrying...',
          error: new Error('Budler gas prices estimation timeout')
        })
      }

      const increment = counter + 1
      return this.fetchGasPrices(network, errorCallback, increment)
    }

    const results = response as GasSpeeds
    return {
      slow: {
        maxFeePerGas: addExtra(BigInt(results.slow.maxFeePerGas), 5n),
        maxPriorityFeePerGas: addExtra(BigInt(results.slow.maxPriorityFeePerGas), 5n)
      },
      medium: {
        maxFeePerGas: addExtra(BigInt(results.medium.maxFeePerGas), 7n),
        maxPriorityFeePerGas: addExtra(BigInt(results.medium.maxPriorityFeePerGas), 7n)
      },
      fast: {
        maxFeePerGas: addExtra(BigInt(results.fast.maxFeePerGas), 10n),
        maxPriorityFeePerGas: addExtra(BigInt(results.fast.maxPriorityFeePerGas), 10n)
      },
      ape: {
        maxFeePerGas: addExtra(BigInt(results.ape.maxFeePerGas), 20n),
        maxPriorityFeePerGas: addExtra(BigInt(results.ape.maxPriorityFeePerGas), 20n)
      }
    }
  }

  // used when catching errors from bundler requests
  decodeBundlerError(e: Error): DecodedError {
    const error = new BundlerError(e.message, this.getName())
    return decodeError(error)
  }
}
