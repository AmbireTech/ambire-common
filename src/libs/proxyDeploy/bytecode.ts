import { JsonRpcProvider } from 'ethers'

import { PROXY_AMBIRE_ACCOUNT } from '../../consts/deploy'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getProxyDeployBytecode, getStorageSlotsFromArtifact, PrivLevels } from './deploy'

export async function getBytecode(
  network: NetworkDescriptor,
  priLevels: PrivLevels[]
): Promise<string> {
  try {
    const provider = new JsonRpcProvider(network.rpcUrl)
    const code = await provider.getCode(PROXY_AMBIRE_ACCOUNT)
    if (code === '0x') throw new Error('No proxy ambire account mined for the specified network')

    // get the bytecode and deploy it
    return getProxyDeployBytecode(PROXY_AMBIRE_ACCOUNT, priLevels, {
      ...getStorageSlotsFromArtifact(null)
    })
  } catch {
    throw new Error(
      'RPC provider failed to fetch the needed data. Please check your RPC settings or try again later.'
    )
  }
}
