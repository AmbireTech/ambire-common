import { useCallback } from 'react'

import networks, { NetworkId, NETWORKS, NetworkType } from '../../constants/networks'
import { UseStorageProps, UseStorageReturnType } from '../useStorage/useStorage'

export default function useNetwork({
  defaultNetwork = NETWORKS.ethereum,
  useStorage
}: {
  defaultNetwork: NetworkId
  useStorage: (p: Omit<UseStorageProps, 'storage'>) => UseStorageReturnType
}) {
  const [networkId, setNetworkId] = useStorage({
    key: 'network',
    defaultValue: defaultNetwork,
    isStringStorage: true,
    setInit: (_networkId: NetworkType['id']) =>
      networks.find((n) => n.id === _networkId) ? _networkId : defaultNetwork
  })

  const setNetwork = useCallback(
    (networkIdentifier) => {
      const network = networks.find(
        (n) =>
          n.id === networkIdentifier ||
          n.name === networkIdentifier ||
          n.chainId === networkIdentifier
      )
      if (!network) throw new Error(`no network found: ${networkIdentifier}`)

      setNetworkId(network.id)
    },
    [setNetworkId]
  )

  return {
    setNetwork,
    network: networks.find((n) => n.id === networkId),
    allNetworks: networks
  }
}
