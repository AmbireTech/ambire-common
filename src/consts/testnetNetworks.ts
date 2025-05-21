import { Network } from '../interfaces/network'

const ALCHEMY_API_KEY = process.env.REACT_APP_ALCHEMY_API_KEY

const testnetNetworks: Network[] = [
  {
    name: 'Sepolia',
    nativeAssetSymbol: 'ETH',
    has7702: false,
    nativeAssetName: 'Ether',
    rpcUrls: ['https://invictus.ambire.com/sepolia'],
    selectedRpcUrl: 'https://invictus.ambire.com/sepolia',
    rpcNoStateOverride: false,
    chainId: 11155111n,
    explorerUrl: 'https://sepolia.etherscan.io',
    erc4337: {
      enabled: false,
      hasPaymaster: false,
      hasBundlerSupport: false
    },
    isSAEnabled: false,
    areContractsDeployed: true,
    hasRelayer: false,
    platformId: 'ethereum-sepolia',
    nativeAssetId: 'ethereum-sepolia',
    hasSingleton: true,
    features: [],
    feeOptions: { is1559: true },
    predefined: true
  },
  {
    name: 'Base Sepolia',
    nativeAssetSymbol: 'ETH',
    has7702: false,
    nativeAssetName: 'Ether',
    rpcUrls: [`https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`],
    selectedRpcUrl: `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    rpcNoStateOverride: false,
    chainId: 84532n,
    explorerUrl: 'https://base-sepolia.blockscout.com',
    erc4337: {
      enabled: false,
      hasPaymaster: false,
      hasBundlerSupport: false
    },
    isSAEnabled: false,
    areContractsDeployed: true,
    hasRelayer: false,
    platformId: 'base-sepolia',
    nativeAssetId: 'base-sepolia',
    hasSingleton: true,
    features: [],
    feeOptions: { is1559: true },
    predefined: true
  },
  {
    name: 'Arbitrum Sepolia',
    nativeAssetSymbol: 'ETH',
    has7702: false,
    nativeAssetName: 'Ether',
    rpcUrls: [`https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`],
    selectedRpcUrl: `https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    rpcNoStateOverride: false,
    chainId: 421614n,
    explorerUrl: 'https://sepolia.arbiscan.io',
    erc4337: {
      enabled: false,
      hasPaymaster: false,
      hasBundlerSupport: false
    },
    isSAEnabled: false,
    areContractsDeployed: true,
    hasRelayer: false,
    platformId: 'arbitrum-sepolia',
    nativeAssetId: 'arbitrum-sepolia',
    hasSingleton: true,
    features: [],
    feeOptions: { is1559: true },
    predefined: true
  }
]
export { testnetNetworks }
