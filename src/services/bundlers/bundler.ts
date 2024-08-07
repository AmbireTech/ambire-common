/* eslint-disable no-restricted-syntax */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable class-methods-use-this */
import { toBeHex } from 'ethers'

import { ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { mapTxnErrMsg } from '../../libs/estimate/errors'
import { BundlerEstimateResult } from '../../libs/estimate/interfaces'
import { Gas1559Recommendation } from '../../libs/gasPrice/gasPrice'
import { privSlot } from '../../libs/proxyDeploy/deploy'
import { UserOperation } from '../../libs/userOperation/types'
import { getCleanUserOp } from '../../libs/userOperation/userOperation'
import { getRpcProvider } from '../provider'

require('dotenv').config()

export class Bundler {
  /**
   * The default pollWaitTime. This is used to determine
   * how many milliseconds to wait until before another request to the
   * bundler for the receipt is sent
   */
  public pollWaitTime = 1500

  /**
   * Get the transaction receipt from the userOperationHash if ready
   *
   * @param userOperationHash
   * @returns Receipt | null
   */
  async getReceipt(userOperationHash: string, network: Network) {
    const url = `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    const provider = getRpcProvider([url], network.chainId)
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
    const result = await Bundler.getStatusAndTxnId(userOperationHash, network)

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
    const url = `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    const provider = getRpcProvider([url], network.chainId)

    return provider.send('eth_sendUserOperation', [
      (({ requestType, activatorCall, ...o }) => o)(userOperation),
      ERC_4337_ENTRYPOINT
    ])
  }

  static async getStatusAndTxnId(userOperationHash: string, network: Network) {
    const url = `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    const provider = getRpcProvider([url], network.chainId)
    return provider.send('pimlico_getUserOperationStatus', [userOperationHash])
  }

  static async getUserOpGasPrice(network: Network) {
    const url = `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    const provider = getRpcProvider([url], network.chainId)
    return provider.send('pimlico_getUserOperationGasPrice', [])
  }

  async pollGetUserOpGasPrice(network: Network, counter = 0): Promise<Gas1559Recommendation[]> {
    if (counter >= 5) {
      throw new Error('unable to fetch bundler gas prices')
    }
    const prices = await Bundler.getUserOpGasPrice(network)
    if (!prices) {
      const delayPromise = (ms: number) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        })
      await delayPromise(this.pollWaitTime)
      return this.pollGetUserOpGasPrice(network, counter + 1)
    }

    // set in the correct ambire format
    prices.medium = prices.standard
    prices.ape = prices.fast
    delete prices.standard

    // transfrom to bigint
    const gasPrices = []
    for (const [key] of Object.entries(prices)) {
      const baseFeePerGas =
        BigInt(prices[key].maxFeePerGas) - BigInt(prices[key].maxPriorityFeePerGas)
      gasPrices.push({
        name: key,
        baseFeePerGas,
        baseFeeToDivide: baseFeePerGas,
        maxPriorityFeePerGas: BigInt(prices[key].maxPriorityFeePerGas)
      })
    }

    return gasPrices
  }

  // use this request to check if the bundler supports the network
  static async isNetworkSupported(fetch: Fetch, chainId: bigint) {
    const url = `https://api.pimlico.io/health?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}&chain-id=${chainId}`
    const result = await fetch(url)
    return result.status === 200
  }

  static async estimate(
    userOperation: UserOperation,
    network: Network,
    shouldStateOverride = false
  ): Promise<BundlerEstimateResult> {
    const url = `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    const provider = getRpcProvider([url], network.chainId)

    if (shouldStateOverride) {
      const stateOverride = {
        [userOperation.sender]: {
          // add privileges to the entry point
          [`0x${privSlot(0, 'address', ERC_4337_ENTRYPOINT, 'bytes32')}`]: ENTRY_POINT_MARKER
        }
      }
      return provider.send('eth_estimateUserOperationGas', [
        getCleanUserOp(userOperation)[0],
        ERC_4337_ENTRYPOINT,
        stateOverride
      ])
    }

    return provider.send('eth_estimateUserOperationGas', [
      getCleanUserOp(userOperation)[0],
      ERC_4337_ENTRYPOINT
    ])
  }

  static async fetchGasPrices(network: Network): Promise<{
    slow: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    medium: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    fast: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    ape: { maxFeePerGas: string; maxPriorityFeePerGas: string }
  }> {
    const url = `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    const provider = getRpcProvider([url], network.chainId)
    const results = await provider.send('pimlico_getUserOperationGasPrice', [])

    const apeMaxFee = BigInt(results.fast.maxFeePerGas) + BigInt(results.fast.maxFeePerGas) / 5n
    const apePriority =
      BigInt(results.fast.maxPriorityFeePerGas) + BigInt(results.fast.maxPriorityFeePerGas) / 5n

    return {
      slow: results.slow,
      medium: results.standard,
      fast: results.fast,
      ape: {
        maxFeePerGas: toBeHex(apeMaxFee),
        maxPriorityFeePerGas: toBeHex(apePriority)
      }
    }
  }

  // used when catching errors from bundler requests
  static decodeBundlerError(e: any, defaultMsg: string): string {
    let errMsg = e.error.message ? e.error.message : defaultMsg
    const hex = errMsg.indexOf('0x') !== -1 ? errMsg.substring(errMsg.indexOf('0x')) : null
    const decodedHex = hex ? mapTxnErrMsg(hex) : null
    if (decodedHex) errMsg = errMsg.replace(hex, decodedHex)
    const finalMsg = mapTxnErrMsg(errMsg)
    return finalMsg ?? errMsg
  }
}
