import networks from '../../constants/networks'

export const getNetworkByChainId = (chainId: string | number) => {
  return networks.find((n) => n.chainId === parseInt(chainId.toString()))
}

export const getNetworkById = (id: string | number) => {
  return networks.find((n) => n.id === id)
}
