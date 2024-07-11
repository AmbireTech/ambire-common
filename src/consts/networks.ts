import { Network } from '../interfaces/network'

const networks: Network[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    nativeAssetSymbol: 'ETH',
    rpcUrls: ['https://invictus.ambire.com/ethereum'],
    selectedRpcUrl: 'https://invictus.ambire.com/ethereum',
    rpcNoStateOverride: false,
    chainId: 1n,
    explorerUrl: 'https://etherscan.io',
    erc4337: { enabled: false, hasPaymaster: false },
    isSAEnabled: true,
    areContractsDeployed: true,
    hasRelayer: true,
    platformId: 'ethereum',
    nativeAssetId: 'ethereum',
    hasSingleton: true,
    features: [],
    feeOptions: { is1559: true },
    predefined: true,
    wrappedAddr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
  },
  {
    id: 'polygon',
    name: 'Polygon',
    nativeAssetSymbol: 'MATIC',
    rpcUrls: ['https://invictus.ambire.com/polygon'],
    selectedRpcUrl: 'https://invictus.ambire.com/polygon',
    rpcNoStateOverride: false,
    chainId: 137n,
    explorerUrl: 'https://polygonscan.com',
    erc4337: { enabled: false, hasPaymaster: true },
    isSAEnabled: true,
    areContractsDeployed: true,
    hasRelayer: true,
    platformId: 'polygon-pos',
    nativeAssetId: 'matic-network',
    hasSingleton: true,
    features: [],
    feeOptions: { is1559: false, feeIncrease: 10n },
    predefined: true,
    wrappedAddr: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
  },
  {
    id: 'optimism',
    name: 'Optimism',
    nativeAssetSymbol: 'ETH',
    rpcUrls: ['https://invictus.ambire.com/optimism'],
    selectedRpcUrl: 'https://invictus.ambire.com/optimism',
    rpcNoStateOverride: false,
    chainId: 10n,
    explorerUrl: 'https://optimistic.etherscan.io',
    erc4337: { enabled: true, hasPaymaster: true },
    isSAEnabled: true,
    areContractsDeployed: true,
    hasRelayer: true,
    platformId: 'optimistic-ethereum',
    nativeAssetId: 'ethereum',
    hasSingleton: true,
    features: [],
    feeOptions: {
      is1559: true,
      elasticityMultiplier: 6n,
      baseFeeMaxChangeDenominator: 50n,
      maxPriorityFee: 100n
    },
    isOptimistic: true,
    predefined: true,
    wrappedAddr: '0x4200000000000000000000000000000000000006'
  },
  {
    id: 'avalanche',
    name: 'Avalanche',
    nativeAssetSymbol: 'AVAX',
    rpcUrls: ['https://invictus.ambire.com/avalanche'],
    selectedRpcUrl: 'https://invictus.ambire.com/avalanche',
    rpcNoStateOverride: false,
    chainId: 43114n,
    explorerUrl: 'https://snowtrace.io',
    erc4337: { enabled: true, hasPaymaster: true },
    isSAEnabled: true,
    areContractsDeployed: true,
    hasRelayer: true,
    platformId: 'avalanche',
    nativeAssetId: 'avalanche-2',
    hasSingleton: true,
    features: [],
    feeOptions: {
      is1559: true,
      minBaseFee: 25000000000n // 25 gwei
    },
    predefined: true,
    wrappedAddr: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7'
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    nativeAssetSymbol: 'ETH',
    rpcUrls: ['https://invictus.ambire.com/arbitrum'],
    selectedRpcUrl: 'https://invictus.ambire.com/arbitrum',
    rpcNoStateOverride: false,
    chainId: 42161n,
    explorerUrl: 'https://arbiscan.io',
    erc4337: {
      enabled: true,
      hasPaymaster: true,
      explorerId: 'arbitrum-one'
    },
    isSAEnabled: true,
    areContractsDeployed: true,
    hasRelayer: true,
    platformId: 'arbitrum-one',
    nativeAssetId: 'ethereum',
    hasSingleton: true,
    features: [],
    feeOptions: {
      is1559: true,
      minBaseFee: 100000000n, // 1 gwei
      maxPriorityFee: 100n
    },
    predefined: true,
    wrappedAddr: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'
  },
  {
    id: 'base',
    name: 'Base',
    nativeAssetSymbol: 'ETH',
    rpcUrls: ['https://invictus.ambire.com/base'],
    selectedRpcUrl: 'https://invictus.ambire.com/base',
    rpcNoStateOverride: false,
    chainId: 8453n,
    explorerUrl: 'https://basescan.org',
    erc4337: {
      enabled: true,
      hasPaymaster: true
    },
    isSAEnabled: true,
    areContractsDeployed: true,
    hasRelayer: true,
    platformId: 'base',
    nativeAssetId: 'ethereum',
    hasSingleton: true,
    features: [],
    feeOptions: {
      is1559: true
    },
    predefined: true,
    wrappedAddr: '0x4200000000000000000000000000000000000006'
  },
  {
    id: 'scroll',
    name: 'Scroll',
    nativeAssetSymbol: 'ETH',
    rpcUrls: ['https://invictus.ambire.com/scroll'],
    selectedRpcUrl: 'https://invictus.ambire.com/scroll',
    rpcNoStateOverride: false,
    chainId: 534352n,
    explorerUrl: 'https://scrollscan.com',
    erc4337: { enabled: false, hasPaymaster: false },
    isSAEnabled: true,
    areContractsDeployed: true,
    hasRelayer: true,
    platformId: 'scroll',
    nativeAssetId: 'ethereum',
    hasSingleton: true,
    features: [],
    feeOptions: { is1559: false },
    predefined: true,
    wrappedAddr: '0x5300000000000000000000000000000000000004'
  },
  {
    id: 'gnosis',
    name: 'Gnosis',
    nativeAssetSymbol: 'XDAI',
    rpcUrls: ['https://invictus.ambire.com/gnosis'],
    selectedRpcUrl: 'https://invictus.ambire.com/gnosis',
    rpcNoStateOverride: true,
    chainId: 100n,
    explorerUrl: 'https://gnosisscan.io',
    erc4337: {
      enabled: false,
      hasPaymaster: false
    },
    isSAEnabled: true,
    areContractsDeployed: true,
    hasRelayer: true,
    platformId: 'xdai',
    nativeAssetId: 'xdai',
    hasSingleton: true,
    features: [],
    feeOptions: {
      is1559: true,
      feeIncrease: 100n
    },
    predefined: true
  }
]

// used for benzin
const extraNetworks = [
  {
    id: 'linea',
    name: 'Linea',
    nativeAssetSymbol: 'ETH',
    rpcUrls: [
      'https://linea.decubate.com',
      'https://linea.blockpi.network/v1/rpc/public',
      'https://1rpc.io/linea',
      'https://linea.drpc.org',
      'https://rpc.linea.build'
    ],
    selectedRpcUrl: 'https://linea.decubate.com	',
    chainId: 59144n,
    explorerUrl: 'https://lineascan.build',
    platformId: 'linea',
    nativeAssetId: 'ethereum'
  },
  {
    id: 'blast',
    name: 'Blast Mainnet',
    nativeAssetSymbol: 'ETH',
    rpcUrls: [
      'https://blast-rpc.publicnode.com',
      'https://rpc.envelop.is/blast',
      'https://rpc.blast.io',
      'https://blast.din.dev/rpc',
      'https://blastl2-mainnet.public.blastapi.io	'
    ],
    selectedRpcUrl: 'https://rpc.blast.io',
    chainId: 81457n,
    explorerUrl: 'https://blastexplorer.io',
    platformId: 'blast',
    nativeAssetId: 'ethereum'
  },
  {
    id: 'andromeda',
    name: 'Metis Andromeda Mainnet',
    nativeAssetSymbol: 'METIS',
    rpcUrls: [
      'https://andromeda.metis.io/?owner=1088',
      'https://metis-mainnet.public.blastapi.io',
      'https://metis.api.onfinality.io/public',
      'https://metis-pokt.nodies.app',
      'https://metis.drpc.org'
    ],
    selectedRpcUrl: 'https://andromeda.metis.io/?owner=1088',
    chainId: 1088n,
    explorerUrl: 'https://explorer.metis.io',
    platformId: 'metis-andromeda',
    nativeAssetId: 'metis-token'
  }
]

export { networks, extraNetworks }
