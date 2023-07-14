import { NetworkDescriptor } from "interfaces/networkDescriptor"
import { PrivLevels, getProxyDeployBytecode, getStorageSlotsFromArtifact } from "./deploy"

const chains: any = {
  polygon: {
    PROXY_AMBIRE_ACCOUNT: '0x59CE8fD321090dBf5fd91256B0a11d65D5b689AE'
  }
}

export function getBytecode(network: NetworkDescriptor, priLevels: PrivLevels[]): string {
  if (! (network.id in chains)) {
    throw new Error('No proxy ambire account mined the specified network')
  }
  
  // get the bytecode and deploy it
  return getProxyDeployBytecode(chains[network.id].PROXY_AMBIRE_ACCOUNT, priLevels, {
    ...getStorageSlotsFromArtifact(null)
  })
}