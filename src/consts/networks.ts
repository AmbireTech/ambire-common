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
    hasDebugTraceCall: false,
    platformId: 'ethereum',
    nativeAssetId: 'ethereum',
    hasSingleton: true,
    features: [],
    feeOptions: { is1559: true },
    predefined: true
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
    hasDebugTraceCall: false,
    platformId: 'polygon-pos',
    nativeAssetId: 'matic-network',
    hasSingleton: true,
    features: [],
    feeOptions: { is1559: false, feeIncrease: 10n },
    predefined: true
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
    hasDebugTraceCall: false,
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
    predefined: true
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
    hasDebugTraceCall: false,
    platformId: 'avalanche',
    nativeAssetId: 'avalanche-2',
    hasSingleton: true,
    features: [],
    feeOptions: {
      is1559: true,
      minBaseFee: 25000000000n // 25 gwei
    },
    predefined: true
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
    hasDebugTraceCall: false,
    platformId: 'arbitrum-one',
    nativeAssetId: 'ethereum',
    hasSingleton: true,
    features: [],
    feeOptions: {
      is1559: true,
      minBaseFee: 100000000n, // 1 gwei
      maxPriorityFee: 100n
    },
    predefined: true
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
    hasDebugTraceCall: false,
    platformId: 'base',
    nativeAssetId: 'ethereum',
    hasSingleton: true,
    features: [],
    feeOptions: {
      is1559: true
    },
    predefined: true
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
    hasDebugTraceCall: false,
    platformId: 'scroll',
    nativeAssetId: 'ethereum',
    hasSingleton: true,
    features: [],
    feeOptions: { is1559: false },
    predefined: true
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
    hasDebugTraceCall: false,
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
    // rpcNoStateOverride: false,
    chainId: 59144n,
    explorerUrl: 'https://lineascan.build',
    // erc4337: {
    //   enabled: false,
    //   hasPaymaster: false
    // },
    // isSAEnabled: true,
    // areContractsDeployed: true,
    // hasRelayer: true,
    // hasDebugTraceCall: false,
    platformId: 'linea',
    nativeAssetId: 'ethereum',
    // hasSingleton: true,
    features: []
    // feeOptions: {
    //   is1559: true,
    //   feeIncrease: 100n
    // },
    // predefined: true
  },
  {
    id: 'blast',
    name: 'Blast Mainnet',
    nativeAssetSymbol: 'ETH',
    rpcUrls: ['https://rpc.blastblockchain.com'],
    selectedRpcUrl: 'https://rpc.blastblockchain.com',
    rpcNoStateOverride: false,
    chainId: 238n,
    explorerUrl: 'https://blastexplorer.io',
    erc4337: {
      enabled: false,
      hasPaymaster: false
    },
    isSAEnabled: true,
    areContractsDeployed: true,
    hasRelayer: true,
    hasDebugTraceCall: false,
    platformId: 'blast',
    nativeAssetId: 'ethereum',
    hasSingleton: true,
    features: [],
    feeOptions: {
      is1559: true,
      feeIncrease: 100n
    },
    predefined: true
  }
]

export { networks, extraNetworks }
