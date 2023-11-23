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
      const delayPromise = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
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
      (({ isEdgeCase, ...o }) => o)(userOperation),
      ERC_4337_ENTRYPOINT
    ])
  }
}
