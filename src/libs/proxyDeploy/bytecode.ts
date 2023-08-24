import { NetworkDescriptor } from "interfaces/networkDescriptor"
import { PrivLevels, getProxyDeployBytecode, getStorageSlotsFromArtifact } from "./deploy"
import { JsonRpcProvider } from "ethers"
import { PROXY_AMBIRE_ACCOUNT } from "../../consts/deploy"

export async function getBytecode(
  network: NetworkDescriptor,
  priLevels: PrivLevels[],
  proxy: string = PROXY_AMBIRE_ACCOUNT
): Promise<string> {
  const provider = new JsonRpcProvider(network.rpcUrl)
  const code = await provider.getCode(proxy)
  if (code === '0x') throw new Error('No proxy ambire account mined for the specified network')
  
  // get the bytecode and deploy it
  return getProxyDeployBytecode(proxy, priLevels, {
    ...getStorageSlotsFromArtifact(null)
  })
}
