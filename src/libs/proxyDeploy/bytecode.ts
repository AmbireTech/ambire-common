import { NetworkDescriptor } from "interfaces/networkDescriptor"
import { PrivLevels, getProxyDeployBytecode, getStorageSlotsFromArtifact } from "./deploy"
import { JsonRpcProvider } from "ethers"
import { PROXY_AMBIRE_ACCOUNT } from "../../consts/deploy"

export async function getBytecode(
  network: NetworkDescriptor,
  priLevels: PrivLevels[]
): Promise<string> {
  const provider = new JsonRpcProvider(network.rpcUrl)
  const code = await provider.getCode(PROXY_AMBIRE_ACCOUNT)
  if (code === '0x') throw new Error('No proxy ambire account mined for the specified network')
  
  // get the bytecode and deploy it
  return getProxyDeployBytecode(PROXY_AMBIRE_ACCOUNT, priLevels, {
    ...getStorageSlotsFromArtifact(null)
  })
}

// use only for tests
export async function get4437Bytecode(
  network: NetworkDescriptor,
  priLevels: PrivLevels[]
): Promise<string> {
  const provider = new JsonRpcProvider(network.rpcUrl)
  let proxy;
  if (network.id == 'optimism') {
    proxy = '0x8b1e9b5eBA56e362383B27b460A15323D5e0bb09'
  } else {
    proxy = '0xd590a2aBA89a590b15De795DE559e7166aC293eA'
  }
  const code = await provider.getCode(proxy)
  if (code === '0x') throw new Error('No proxy ambire account mined for the specified network')
  
  // get the bytecode and deploy it
  return getProxyDeployBytecode(proxy, priLevels, {
    ...getStorageSlotsFromArtifact(null)
  })
}
