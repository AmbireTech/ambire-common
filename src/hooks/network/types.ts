import { NetworkId, NetworkType } from '../../constants/networks'
import { UseStorageProps, UseStorageReturnType } from '../useStorage/useStorage'

export type UseNetworkReturnTypes = {
  setNetwork: (networkIdentifier: string | number) => void
  network: NetworkType | undefined
  allNetworks: NetworkType[]
}

export type UseNetworkProps = {
  defaultNetwork: NetworkId
  useStorage: (p: Omit<UseStorageProps, 'storage'>) => UseStorageReturnType
}
