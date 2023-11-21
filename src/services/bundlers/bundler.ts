import { ERC_4337_ENTRYPOINT } from "../../../dist/src/consts/deploy";
import { UserOperation } from "../../libs/userOperation/userOperation";
import { NetworkDescriptor } from "../../interfaces/networkDescriptor";
import { StaticJsonRpcProvider } from "@ethersproject/providers";

require('dotenv').config();

const delayPromise = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
    return provider.send("eth_getUserOperationReceipt", [userOperationHash])
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
      await delayPromise(this.pollWaitTime)
      return this.poll(userOperationHash, network)
    }
    return receipt
  }

  /**
   * Call getTxnHash until a result is returned
   *
   * @param userOperationHash
   * @param network
   * @returns https://docs.pimlico.io/bundler/reference/endpoints#pimlico_getuseroperationstatus
   */
  async getTxnHash(userOperationHash: string, network: NetworkDescriptor): Promise<any> {
    const url = `https://api.pimlico.io/v1/${network.id}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
    const provider = new StaticJsonRpcProvider(url)
    const statusRes = await provider.send("pimlico_getUserOperationStatus", [userOperationHash])
    console.log(statusRes)
    if (statusRes.result.status == 'not_found') {
      await delayPromise(this.pollWaitTime)
      return this.getTxnHash(userOperationHash, network)
    }
    return statusRes.result.transactionHash
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

    return provider.send(
      "eth_sendUserOperation",
      [(({ isEdgeCase, ...o }) => o)(userOperation), ERC_4337_ENTRYPOINT]
    )
  }
}