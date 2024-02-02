import { JsonRpcProvider } from 'ethers'
import { PROXY_AMBIRE_4337_ACCOUNT, PROXY_AMBIRE_ACCOUNT } from '../../consts/deploy'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getProxyDeployBytecode, getStorageSlotsFromArtifact, PrivLevels } from './deploy'

export async function getBytecode(priLevels: PrivLevels[]): Promise<string> {
  // get the bytecode and deploy it
  return getProxyDeployBytecode(PROXY_AMBIRE_ACCOUNT, priLevels, {
    ...getStorageSlotsFromArtifact(null)
  })
}
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
