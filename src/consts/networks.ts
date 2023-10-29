import { NetworkDescriptor, NetworkId } from '../interfaces/networkDescriptor'
import { ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT } from './deploy'

const networks: NetworkDescriptor[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    nativeAssetSymbol: 'ETH',
    rpcUrl: 'https://rpc.ankr.com/eth',
    rpcNoStateOverride: false,
    chainId: 1n,
    explorerUrl: 'https://etherscan.io',
    erc4337: null,
    unstoppableDomainsChain: 'ERC20'
  },
  {
    id: 'polygon',
    name: 'Polygon',
    nativeAssetSymbol: 'MATIC',
    rpcUrl: 'https://rpc.ankr.com/polygon',
    rpcNoStateOverride: false,
    chainId: 137n,
    explorerUrl: 'https://polygonscan.com',
    erc4337: {
      enabled: true,
      entryPointAddr: ERC_4337_ENTRYPOINT,
      entryPointMarker: ENTRY_POINT_MARKER
    },
    unstoppableDomainsChain: 'MATIC'
  },
  {
    id: 'optimism',
    name: 'Optimism',
    nativeAssetSymbol: 'ETH',
    rpcUrl: 'https://rpc.ankr.com/optimism',
    rpcNoStateOverride: false,
    chainId: 10n,
    explorerUrl: 'https://optimistic.etherscan.io',
    erc4337: {
      enabled: true,
      entryPointAddr: ERC_4337_ENTRYPOINT,
      entryPointMarker: ENTRY_POINT_MARKER
    },
    unstoppableDomainsChain: 'ERC20'
  }
  // This breaks the background service of the extension
  // {
  //   id: 'hardhat',
  //   name: 'hardhat',
  //   nativeAssetSymbol: 'ETH',
  //   rpcUrl: '',
  //   rpcNoStateOverride: true,
  //   chainId: 31337n
  // }
]

export { networks }
