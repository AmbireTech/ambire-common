import { PROXY_AMBIRE_ACCOUNT } from '../../consts/deploy'
import { getProxyDeployBytecode, getStorageSlotsFromArtifact, PrivLevels } from './deploy'

export async function getBytecode(priLevels: PrivLevels[]): Promise<string> {
  // get the bytecode and deploy it
  return getProxyDeployBytecode(PROXY_AMBIRE_ACCOUNT, priLevels, {
    ...getStorageSlotsFromArtifact(null)
  })
}
