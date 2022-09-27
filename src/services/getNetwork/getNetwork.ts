import networks from '../../constants/networks'

export const getNetworkByChainId = (chainId?: string | number) => {
  if (!chainId) return null

  return networks.find((n) => n.chainId === parseInt(chainId.toString(), 10))
}

export const getNetworkById = (id: string | number) => {
  return networks.find((n) => n.id === id)
}
