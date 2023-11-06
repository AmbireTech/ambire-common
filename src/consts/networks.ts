import { NetworkDescriptor, NetworkId } from '../interfaces/networkDescriptor'
import { ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT } from './deploy'

const networks: NetworkDescriptor[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    nativeAssetSymbol: 'ETH',
    rpcUrl:
      'https://rpc.ankr.com/eth/5c7b8f0ac82c95161753873289e1a4f39aa69019b905b8032d76909962719be9',
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
    rpcUrl:
      'https://rpc.ankr.com/polygon/5c7b8f0ac82c95161753873289e1a4f39aa69019b905b8032d76909962719be9',
    rpcNoStateOverride: false,
    chainId: 137n,
    explorerUrl: 'https://polygonscan.com',
    erc4337: {
      // TODO: temp disabled (only while testing)
      enabled: false,
      entryPointAddr: ERC_4337_ENTRYPOINT,
      entryPointMarker: ENTRY_POINT_MARKER
    },
    unstoppableDomainsChain: 'MATIC'
  },
  {
    id: 'optimism',
    name: 'Optimism',
    nativeAssetSymbol: 'ETH',
    rpcUrl:
      'https://rpc.ankr.com/optimism/5c7b8f0ac82c95161753873289e1a4f39aa69019b905b8032d76909962719be9',
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

const nativeTokens: { [key: NetworkId]: [string, number] } = {
  ethereum: ['ETH', 18],
  polygon: ['MATIC', 18],
  fanthom: ['FTM', 18]
}
export { networks, nativeTokens }
