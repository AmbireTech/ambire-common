import { useCallback } from 'react'

import networks, { NETWORKS, NetworkType } from '../../constants/networks'
import { UseNetworkProps, UseNetworkReturnTypes } from './types'

export default function useNetwork({
  defaultNetwork = NETWORKS.ethereum,
  useStorage
}: UseNetworkProps): UseNetworkReturnTypes {
  const [networkId, setNetworkId] = useStorage({
    key: 'network',
    defaultValue: defaultNetwork,
    isStringStorage: true,
    setInit: (_networkId: NetworkType['id']) =>
      networks.find((n) => n.id === _networkId) ? _networkId : defaultNetwork
  })

  const setNetwork = useCallback(
    (networkIdentifier: string | number) => {
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
