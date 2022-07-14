import { NetworkId, NetworkType } from '../../constants/networks'
import { UseStorageType } from '../useStorage'

export type UseNetworkProps = {
  defaultNetwork: NetworkId
  useStorage: UseStorageType
  allNetworks: NetworkType[]
}

export type UseNetworkReturnType = {
  setNetwork: (networkIdentifier: string | number) => void
  network: NetworkType | undefined
  allNetworks: NetworkType[]
}
