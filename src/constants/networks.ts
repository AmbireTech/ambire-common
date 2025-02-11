export enum NETWORKS {
  'ethereum' = 'ethereum',
  'polygon' = 'polygon',
  'avalanche' = 'avalanche',
  'binance-smart-chain' = 'binance-smart-chain',
  'fantom' = 'fantom',
  'moonbeam' = 'moonbeam',
  'moonriver' = 'moonriver',
  'arbitrum' = 'arbitrum',
  'gnosis' = 'gnosis',
  'kucoin' = 'kucoin',
  'optimism' = 'optimism',
  'andromeda' = 'andromeda',
  'cronos' = 'cronos',
  'aurora' = 'aurora',
  'okc' = 'okc',
  'base' = 'base',
  'scroll' = 'scroll',
  'ethereum-pow' = 'ethereum-pow',
  'rinkeby' = 'rinkeby',
  'sepolia' = 'sepolia'
}

export type NetworkId = keyof typeof NETWORKS

export type NetworkType = {
  id: NetworkId
  chainId: number
  nativeAssetSymbol: string
  name: string
  ensName?: string
  explorerUrl: string
  unstoppableDomainsChain: string
  hide?: boolean
  isGasTankAvailable: boolean
  relayerlessOnly: boolean
  nativeAsset: {
    address: string
    symbol: string
    coingeckoId: any
    decimals: number
    wrappedAddr?: string
  }
}

const networks: NetworkType[] = [
  {
    id: NETWORKS.ethereum,
    chainId: 1,
    nativeAssetSymbol: 'ETH',
    name: 'Ethereum',
    ensName: 'homestead',
    explorerUrl: 'https://etherscan.io',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      coingeckoId: 'ethereum',
      decimals: 18,
      wrappedAddr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    }
  },
  {
    id: NETWORKS.polygon,
    chainId: 137,
    nativeAssetSymbol: 'POL',
    name: 'Polygon',
    explorerUrl: 'https://polygonscan.com',
    unstoppableDomainsChain: 'MATIC',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'POL',
      coingeckoId: 'matic-network',
      decimals: 18,
      wrappedAddr: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
    }
  },
  {
    id: NETWORKS.avalanche,
    chainId: 43114,
    nativeAssetSymbol: 'AVAX',
    name: 'Avalanche',
    explorerUrl: 'https://snowtrace.io',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'AVAX',
      coingeckoId: 'avalanche-2',
      decimals: 18,
      wrappedAddr: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7'
    }
  },
  {
    // to match the zapper ID
    id: NETWORKS['binance-smart-chain'],
    chainId: 56,
    nativeAssetSymbol: 'BNB',
    name: 'BNB Chain',
    explorerUrl: 'https://bscscan.com',
    unstoppableDomainsChain: 'BEP20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'BNB',
      coingeckoId: 'binancecoin',
      decimals: 18,
      wrappedAddr: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
    }
  },
  {
    id: NETWORKS.fantom,
    chainId: 250,
    nativeAssetSymbol: 'FTM',
    name: 'Fantom Opera',
    explorerUrl: 'https://ftmscan.com',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'FTM',
      coingeckoId: 'fantom',
      decimals: 18,
      wrappedAddr: '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83'
    }
  },
  {
    id: NETWORKS.moonbeam,
    chainId: 1284,
    nativeAssetSymbol: 'GLMR',
    name: 'Moonbeam',
    explorerUrl: 'https://moonscan.io/',
    unstoppableDomainsChain: 'ERC20',
    hide: true,
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'GLMR',
      coingeckoId: 'moonbeam',
      decimals: 18,
      wrappedAddr: '0x5f6c5C2fB289dB2228d159C69621215e354218d7'
    }
  },
  {
    id: NETWORKS.moonriver,
    chainId: 1285,
    nativeAssetSymbol: 'MOVR',
    name: 'Moonriver',
    explorerUrl: 'https://moonriver.moonscan.io/',
    unstoppableDomainsChain: 'ERC20',
    hide: true,
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'MOVR',
      coingeckoId: 'moonriver',
      decimals: 18,
      wrappedAddr: '0x98878b06940ae243284ca214f92bb71a2b032b8a'
    }
  },
  {
    id: NETWORKS.arbitrum,
    chainId: 42161,
    nativeAssetSymbol: 'AETH',
    name: 'Arbitrum',
    explorerUrl: 'https://arbiscan.io',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'AETH',
      coingeckoId: 'ethereum',
      decimals: 18,
      wrappedAddr: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'
    }
  },
  {
    id: NETWORKS.gnosis,
    chainId: 100,
    nativeAssetSymbol: 'XDAI',
    name: 'Gnosis Chain',
    explorerUrl: 'https://gnosisscan.io',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'XDAI',
      coingeckoId: 'xdai',
      decimals: 18,
      wrappedAddr: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d'
    }
  },
  {
    id: NETWORKS.kucoin,
    chainId: 321,
    nativeAssetSymbol: 'KCS',
    name: 'KCC KuCoin',
    explorerUrl: 'https://explorer.kcc.io',
    unstoppableDomainsChain: 'ERC20',
    hide: true,
    isGasTankAvailable: false,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'KCS',
      coingeckoId: 'kucoin-shares',
      decimals: 18,
      wrappedAddr: '0x4446fc4eb47f2f6586f9faab68b3498f86c07521'
    }
  },
  {
    id: NETWORKS.optimism,
    chainId: 10,
    nativeAssetSymbol: 'ETH',
    name: 'Optimism',
    explorerUrl: 'https://optimistic.etherscan.io',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      coingeckoId: 'ethereum',
      decimals: 18,
      wrappedAddr: '0x4200000000000000000000000000000000000006'
    }
  },
  {
    id: NETWORKS.base,
    chainId: 8453,
    nativeAssetSymbol: 'ETH',
    name: 'Base',
    explorerUrl: 'https://basescan.org/',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      coingeckoId: 'ethereum',
      decimals: 18,
      wrappedAddr: '0x4200000000000000000000000000000000000006'
    }
  },
  {
    id: NETWORKS.scroll,
    chainId: 534352,
    nativeAssetSymbol: 'ETH',
    name: 'Scroll',
    explorerUrl: 'https://scrollscan.com/',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      coingeckoId: 'ethereum',
      decimals: 18,
      wrappedAddr: '0x5300000000000000000000000000000000000004'
    }
  },
  {
    id: NETWORKS.andromeda,
    chainId: 1088,
    nativeAssetSymbol: 'METIS',
    name: 'Metis',
    explorerUrl: 'https://andromeda-explorer.metis.io',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'METIS',
      coingeckoId: 'metis-token',
      decimals: 18,
      wrappedAddr: '0x75cb093e4d61d2a2e65d8e0bbb01de8d89b53481'
    }
  },
  {
    id: NETWORKS.okc,
    chainId: 66,
    nativeAssetSymbol: 'OTK',
    name: 'OKX Chain',
    explorerUrl: 'https://www.oklink.com/en/okc',
    unstoppableDomainsChain: 'ERC20',
    hide: true,
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'OTK',
      coingeckoId: 'oec-token',
      decimals: 18,
      wrappedAddr: '0xe538905cf8410324e03a5a23c1c177a474d59b2b'
    }
  },
  {
    id: NETWORKS.rinkeby,
    chainId: 4,
    nativeAssetSymbol: 'ETH',
    name: 'Rinkeby',
    explorerUrl: 'https://rinkeby.etherscan.io',
    unstoppableDomainsChain: 'ERC20',
    hide: true,
    isGasTankAvailable: false,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      coingeckoId: 'ethereum',
      decimals: 18
    }
  },
  {
    id: NETWORKS.sepolia,
    chainId: 11155111,
    nativeAssetSymbol: 'ETH',
    name: 'Sepolia',
    explorerUrl: 'https://sepolia.etherscan.io/',
    unstoppableDomainsChain: 'ERC20',
    hide: true,
    isGasTankAvailable: false,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      coingeckoId: 'ethereum',
      decimals: 18
    }
  },
  {
    id: NETWORKS['ethereum-pow'],
    chainId: 10001,
    nativeAssetSymbol: 'ETHW',
    name: 'ETHPoW',
    explorerUrl: 'https://mainnet.ethwscan.com',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: false,
    relayerlessOnly: true,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      coingeckoId: 'ethereum-pow-iou',
      decimals: 18
    }
  }
  // {
  // 	id: NETWORKS.cronos,
  // 	chainId: 25,
  // 	nativeAssetSymbol: 'CRO',
  // 	name: 'Cronos',
  // 	explorerUrl: 'https://cronoscan.com',
  // 	unstoppableDomainsChain: 'ERC20',
  // },
  // {
  // 	id: NETWORKS.aurora,
  // 	chainId: 1313161554,
  // 	nativeAssetSymbol: 'ETH',
  // 	name: 'NEAR Aurora',
  // 	explorerUrl: 'https://aurorascan.dev',
  // 	unstoppableDomainsChain: 'ERC20',
  // }
]

export const coingeckoNets = {
  ethereum: 'ethereum',
  'polygon-pos': 'polygon',
  polygon: 'polygon-pos',
  'binance-smart-chain': 'binance-smart-chain',
  avalanche: 'avalanche',
  fantom: 'fantom',
  moonbeam: 'moonbeam',
  moonriver: 'moonriver',
  'arbitrum-one': 'arbitrum',
  arbitrum: 'arbitrum-one',
  gnosis: 'xdai',
  xdai: 'gnosis',
  'kucoin-community-chain': 'kucoin',
  kucoin: 'kucoin-community-chain',
  'metis-andromeda': 'andromeda',
  andromeda: 'metis-andromeda',
  cronos: 'cronos',
  aurora: 'aurora',
  optimism: 'optimistic-ethereum',
  'optimistic-ethereum': 'optimism',
  base: 'base',
  scroll: 'scroll'
}

export default networks