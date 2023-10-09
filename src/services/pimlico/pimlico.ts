import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { ERC_4337_ENTRYPOINT } from "../../../dist/src/consts/deploy";
import { UserOperation } from "libs/userOperation/userOperation";

require('dotenv').config();

const ENDPOINT = `https://api.pimlico.io/v1/polygon/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
const provider = new StaticJsonRpcProvider(ENDPOINT)

// how many times do we retry the getReceipt function before declaring error
const RETRY_COUNTER = 10

export async function getReceipt(userOperationHash: string) {
    let receipt = null
    let counter = 0
    while (!receipt && counter < RETRY_COUNTER) {
      try {
        await new Promise((r) => setTimeout(r, 1000)) //sleep
        counter++
        return await provider.send("eth_getUserOperationReceipt", [userOperationHash])
      } catch (e) {}
    }

    // TODO: throw a proper error
    throw new Error("Couldn't fetch");
}

/**
 * Broadcast a userOperation to pimlico and get a userOperationHash in return
 *
 * @param UserOperation userOperation
 * @returns userOperationHash
 */
export async function broadcast(userOperation: UserOperation): Promise<string> {
    return provider.send("eth_sendUserOperation", [userOperation, ERC_4337_ENTRYPOINT])
}
