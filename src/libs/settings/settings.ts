import { RPCProviders } from '../../interfaces/settings'

export const getNetworksWithFailedRPC = ({ providers }: { providers: RPCProviders }): string[] => {
  return Object.keys(providers).filter((networkId) => !providers[networkId].isWorking)
}
