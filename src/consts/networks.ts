import { NetworkDescriptor } from '../interfaces/networkDescriptor'

// @TODO: add more networks
const networks: NetworkDescriptor[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    nativeAssetSymbol: 'ETH',
    rpcUrl: 'https://rpc.ankr.com/eth',
    rpcNoStateOverride: false,
    chainId: 1n
  },
  {
    id: 'polygon',
    name: 'Polygon',
    nativeAssetSymbol: 'MATIC',
    rpcUrl: 'https://rpc.ankr.com/polygon',
    rpcNoStateOverride: false,
    chainId: 137n
  },
  {
    id: 'optimism',
    name: 'Optimism',
    nativeAssetSymbol: 'ETH',
    rpcUrl: 'https://rpc.ankr.com/optimism',
    rpcNoStateOverride: false,
    chainId: 10n
  }
]

export { networks }
