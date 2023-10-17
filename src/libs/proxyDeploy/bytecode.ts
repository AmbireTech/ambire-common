import { NetworkDescriptor } from "../../interfaces/networkDescriptor"
import { PrivLevels, getProxyDeployBytecode, getStorageSlotsFromArtifact } from "./deploy"
import { JsonRpcProvider } from "ethers"
import { PROXY_AMBIRE_4337_ACCOUNT, PROXY_AMBIRE_ACCOUNT } from "../../consts/deploy"
import { networks } from '../../consts/networks'

export async function getBytecode(priLevels: PrivLevels[]): Promise<string> {
  const ethereum = networks.find((x) => x.id === 'ethereum')
  if (!ethereum) throw new Error('unable to find ethereum network in consts')
  const provider = new JsonRpcProvider(ethereum.rpcUrl)
  const code = await provider.getCode(PROXY_AMBIRE_ACCOUNT)
  if (code === '0x') throw new Error('No proxy ambire account mined on mainnet')
  
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
  const code = await provider.getCode(PROXY_AMBIRE_4337_ACCOUNT)
  if (code === '0x') throw new Error('No proxy ambire account mined for the specified network')
  
  // get the bytecode and deploy it
  return getProxyDeployBytecode(PROXY_AMBIRE_4337_ACCOUNT, priLevels, {
    ...getStorageSlotsFromArtifact(null)
  })
}
