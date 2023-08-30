import { NetworkDescriptor } from '../interfaces/networkDescriptor'
import { ERC_4337_ENTRYPOINT, ENTRY_POINT_MARKER } from './deploy'

const networks: NetworkDescriptor[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    nativeAssetSymbol: 'ETH',
    rpcUrl: 'https://rpc.ankr.com/eth',
    rpcNoStateOverride: false,
    chainId: 1n,
    erc4337: null
  },
  {
    id: 'polygon',
    name: 'Polygon',
    nativeAssetSymbol: 'MATIC',
    rpcUrl: 'https://rpc.ankr.com/polygon',
    rpcNoStateOverride: false,
    chainId: 137n,
    erc4337: {
      enabled: true,
      entryPointAddr: ERC_4337_ENTRYPOINT,
      entryPointMarker: ENTRY_POINT_MARKER
    }
  },
  {
    id: 'optimism',
    name: 'Optimism',
    nativeAssetSymbol: 'ETH',
    rpcUrl: 'https://rpc.ankr.com/optimism',
    rpcNoStateOverride: false,
    chainId: 10n,
    erc4337: {
      enabled: true,
      entryPointAddr: ERC_4337_ENTRYPOINT,
      entryPointMarker: ENTRY_POINT_MARKER
    }
  }
]

export { networks }
