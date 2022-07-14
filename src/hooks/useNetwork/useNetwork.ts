import { useCallback } from 'react'

import networks, { NETWORKS, NetworkType } from '../../constants/networks'
import { UseNetworkProps, UseNetworkReturnType } from './types'

export default function useNetwork({
  defaultNetwork = NETWORKS.ethereum,
  useStorage,
  allNetworks = networks
}: UseNetworkProps): UseNetworkReturnType {
  const [networkId, setNetworkId] = useStorage({
    key: 'network',
    defaultValue: defaultNetwork,
    isStringStorage: true,
    setInit: (_networkId: NetworkType['id']) =>
      allNetworks.find((n) => n.id === _networkId) ? _networkId : defaultNetwork
  })

  const setNetwork = useCallback(
    (networkIdentifier: string | number) => {
      const network = allNetworks.find(
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
    network: allNetworks.find((n) => n.id === networkId),
    allNetworks
  }
}
