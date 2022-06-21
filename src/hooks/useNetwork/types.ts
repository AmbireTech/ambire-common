import { NetworkId, NetworkType } from '../../constants/networks'
import { UseStorageProps, UseStorageReturnType } from '../useStorage'

export type UseNetworkProps = {
  defaultNetwork: NetworkId
  useStorage: (p: Omit<UseStorageProps, 'storage'>) => UseStorageReturnType
}

export type UseNetworkReturnType = {
  setNetwork: (networkIdentifier: string | number) => void
  network: NetworkType | undefined
  allNetworks: NetworkType[]
}
