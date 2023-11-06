import { ERC_4337_ENTRYPOINT } from "../../../dist/src/consts/deploy";
import { UserOperation } from "../../libs/userOperation/userOperation";
import conf from '../../config/conf'
import { NetworkDescriptor } from "../../interfaces/networkDescriptor";

require('dotenv').config();

// how many times do we retry the getReceipt function before declaring error
const RETRY_COUNTER = 7

export class Bundler {
  /**
   * Get the transaction receipt from the userOperationHash
   *
   * @param userOperationHash
   * @returns Receipt | null
   */
  async getReceipt(userOperationHash: string, network: NetworkDescriptor) {
    const provider = conf.bundler.getProvider(network)

    let counter = 0
    while (counter < RETRY_COUNTER) {
      await new Promise((r) => setTimeout(r, 1000)) //sleep
      counter++
      const res = await provider.send("eth_getUserOperationReceipt", [userOperationHash])
      if (!res) continue
      return res
    }

    return null
  }

  /**
   * Broadcast a userOperation to the specified bundler and get a userOperationHash in return
   *
   * @param UserOperation userOperation
   * @returns userOperationHash
   */
  async broadcast(userOperation: UserOperation, network: NetworkDescriptor): Promise<string> {
    return conf.bundler.getProvider(network).send(
      "eth_sendUserOperation",
      [(({ isEdgeCase, ...o }) => o)(userOperation), ERC_4337_ENTRYPOINT]
    )
  }
}