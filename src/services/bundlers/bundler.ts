/* eslint-disable no-restricted-syntax */
/* eslint-disable import/no-extraneous-dependencies */

import { Gas1559Recommendation } from 'libs/gasPrice/gasPrice'
import fetch from 'node-fetch'

import { StaticJsonRpcProvider } from '@ethersproject/providers'

import { ERC_4337_ENTRYPOINT } from '../../../dist/src/consts/deploy'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { UserOperation } from '../../libs/userOperation/types'

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
  async getReceipt(userOperationHash: string, network: NetworkDescriptor) {
    const url = `https://api.pimlico.io/v1/${network.id}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    const provider = new StaticJsonRpcProvider(url)
    return provider.send('eth_getUserOperationReceipt', [userOperationHash])
  }

  /**
   * Call getReceipt until a result is returned
   *
   * @param userOperationHash
   * @param network
   * @returns https://docs.alchemy.com/reference/eth-getuseroperationreceipt
   */
  async poll(userOperationHash: string, network: NetworkDescriptor): Promise<any> {
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
   * Broadcast a userOperation to the specified bundler and get a userOperationHash in return
   *
   * @param UserOperation userOperation
   * @returns userOperationHash
   */
  async broadcast(userOperation: UserOperation, network: NetworkDescriptor): Promise<string> {
    const url = `https://api.pimlico.io/v1/${network.id}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    const provider = new StaticJsonRpcProvider(url)

    return provider.send('eth_sendUserOperation', [
      (({ requestType, activatorCall, ...o }) => o)(userOperation),
      ERC_4337_ENTRYPOINT
    ])
  }

  static async getStatusAndTxnId(userOperationHash: string, network: NetworkDescriptor) {
    const url = `https://api.pimlico.io/v1/${network.id}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    const provider = new StaticJsonRpcProvider(url)
    return provider.send('pimlico_getUserOperationStatus', [userOperationHash])
  }

  static async getUserOpGasPrice(network: NetworkDescriptor) {
    const url = `https://api.pimlico.io/v1/${network.id}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    const provider = new StaticJsonRpcProvider(url)
    return provider.send('pimlico_getUserOperationGasPrice', [])
  }

  async pollGetUserOpGasPrice(
    network: NetworkDescriptor,
    counter = 0
  ): Promise<Gas1559Recommendation[]> {
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
  static async isNetworkSupported(chainId: bigint) {
    const url = `https://api.pimlico.io/health?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}&chain-id=${chainId}`
    const result = await fetch(url)
    return result.status === 200
  }
}
