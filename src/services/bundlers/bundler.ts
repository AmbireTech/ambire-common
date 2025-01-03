/* eslint-disable no-restricted-syntax */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable class-methods-use-this */
import { toBeHex } from 'ethers'

import { ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { decodeError } from '../../libs/errorDecoder'
import { BundlerEstimateResult } from '../../libs/estimate/interfaces'
import { privSlot } from '../../libs/proxyDeploy/deploy'
import { UserOperation } from '../../libs/userOperation/types'
import { getCleanUserOp } from '../../libs/userOperation/userOperation'
import { getRpcProvider } from '../provider'
import { GasSpeeds } from './types'

require('dotenv').config()

function addExtra(gasInWei: bigint, percentageIncrease: bigint): `0x${string}` {
  const percent = 100n / percentageIncrease
  return toBeHex(gasInWei + gasInWei / percent) as `0x${string}`
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
   * Get the bundler RPC
   *
   * @param network
   */
  protected getProvider(network: Network): RPCProvider {
    return getRpcProvider([this.getUrl(network)], network.chainId)
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
   * Call getReceipt until a result is returned
   *
   * @param userOperationHash
   * @param network
   * @returns https://docs.alchemy.com/reference/eth-getuseroperationreceipt
   */
  async poll(userOperationHash: string, network: Network): Promise<any> {
    const receipt = await this.getReceipt(userOperationHash, network)
    if (!receipt) {
      const delayPromise = (ms: number) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        })
      await delayPromise(this.pollWaitTime)
      return this.poll(userOperationHash, network)
    }
    return receipt
  }

  /**
   * Call getStatusAndTxnId until a result containing transactionHash is returned
   *
   * @param userOperationHash
   * @param network
   * @returns {transactionHash: string|null}
   */
  async pollTxnHash(
    userOperationHash: string,
    network: Network
  ): Promise<{ transactionHash: string; status: string }> {
    const result = await this.getStatusAndTxnId(userOperationHash, network)

    // if the bundler has rejected the userOp, no meaning in continuing to poll
    if (result && result.status === 'rejected') {
      return result
    }

    if (!result || !result.transactionHash) {
      const delayPromise = (ms: number) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        })
      await delayPromise(this.pollWaitTime)
      return this.pollTxnHash(userOperationHash, network)
    }
    return result
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

  async getStatusAndTxnId(userOperationHash: string, network: Network) {
    const provider = this.getProvider(network)
    return provider.send('pimlico_getUserOperationStatus', [userOperationHash])
  }

  // use this request to check if the bundler supports the network
  static async isNetworkSupported(fetch: Fetch, chainId: bigint) {
    const url = `https://api.pimlico.io/health?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}&chain-id=${chainId}`
    const result = await fetch(url)
    return result.status === 200
  }

  async estimate(
    userOperation: UserOperation,
    network: Network,
    shouldStateOverride = false
  ): Promise<BundlerEstimateResult> {
    const provider = this.getProvider(network)

    if (shouldStateOverride) {
      return provider.send('eth_estimateUserOperationGas', [
        getCleanUserOp(userOperation)[0],
        ERC_4337_ENTRYPOINT,
        {
          [userOperation.sender]: {
            stateDiff: {
              // add privileges to the entry point
              [`0x${privSlot(0, 'address', ERC_4337_ENTRYPOINT, 'bytes32')}`]: ENTRY_POINT_MARKER
            }
          }
        }
      ])
    }

    return provider.send('eth_estimateUserOperationGas', [
      getCleanUserOp(userOperation)[0],
      ERC_4337_ENTRYPOINT
    ])
  }

  async fetchGasPrices(
    network: Network,
    errorCallback: Function,
    counter: number = 0
  ): Promise<GasSpeeds> {
    if (counter >= 5) throw new Error("Couldn't fetch gas prices")

    let response

    try {
      response = await Promise.race([
        this.getGasPrice(network),
        new Promise((_resolve, reject) => {
          setTimeout(
            () => reject(new Error('fetching bundler gas prices failed, request too slow')),
            6000
          )
        })
      ])
    } catch (e: any) {
      errorCallback({
        level: 'major',
        message: 'Estimating gas prices from the bundler timed out. Retrying...',
        error: new Error('Budler gas prices estimation timeout')
      })
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
  decodeBundlerError(e: any): string {
    const { reason } = decodeError(e)

    return reason || 'Unknown error'
  }
}
