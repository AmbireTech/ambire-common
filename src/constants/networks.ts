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
  'rinkeby' = 'rinkeby',
  'mumbai' = 'mumbai',
  'cronos' = 'cronos',
  'aurora' = 'aurora',
  'ethereum-pow' = 'ethereum-pow'
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
      coingeckoId: null,
      decimals: 18
    }
  },
  {
    id: NETWORKS.polygon,
    chainId: 137,
    nativeAssetSymbol: 'MATIC',
    name: 'Polygon',
    explorerUrl: 'https://polygonscan.com',
    unstoppableDomainsChain: 'MATIC',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'MATIC',
      coingeckoId: null,
      decimals: 18
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
      coingeckoId: null,
      decimals: 18
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
      coingeckoId: null,
      decimals: 18
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
      coingeckoId: null,
      decimals: 18
    }
  },
  {
    id: NETWORKS.moonbeam,
    chainId: 1284,
    nativeAssetSymbol: 'GLMR',
    name: 'Moonbeam',
    explorerUrl: 'https://moonscan.io/',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'GLMR',
      coingeckoId: null,
      decimals: 18
    }
  },
  {
    id: NETWORKS.moonriver,
    chainId: 1285,
    nativeAssetSymbol: 'MOVR',
    name: 'Moonriver',
    explorerUrl: 'https://moonriver.moonscan.io/',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'MOVR',
      coingeckoId: null,
      decimals: 18
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
      coingeckoId: null,
      decimals: 18
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
      coingeckoId: null,
      decimals: 18
    }
  },
  {
    id: NETWORKS.kucoin,
    chainId: 321,
    nativeAssetSymbol: 'KCS',
    name: 'KCC KuCoin',
    explorerUrl: 'https://explorer.kcc.io',
    unstoppableDomainsChain: 'ERC20',
    hide: false,
    isGasTankAvailable: false,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'KCS',
      coingeckoId: null,
      decimals: 18
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
      coingeckoId: null,
      decimals: 18
    }
  },
  {
    id: NETWORKS.andromeda,
    chainId: 1088,
    nativeAssetSymbol: 'METIS',
    name: 'Andromeda',
    explorerUrl: 'https://andromeda-explorer.metis.io',
    unstoppableDomainsChain: 'ERC20',
    isGasTankAvailable: true,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'METIS',
      coingeckoId: null,
      decimals: 18
    }
  },
  {
    id: 'rinkeby',
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
      coingeckoId: null,
      decimals: 18
    }
  },
  {
    id: NETWORKS.mumbai,
    chainId: 80001,
    nativeAssetSymbol: 'MATIC',
    name: 'Mumbai',
    explorerUrl: 'https://mumbai.polygonscan.com/',
    unstoppableDomainsChain: 'ERC20',
    hide: true,
    isGasTankAvailable: false,
    relayerlessOnly: false,
    nativeAsset: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'MATIC',
      coingeckoId: null,
      decimals: 18
    }
  },
  {
    id: 'ethereum-pow',
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
      coingeckoId: null,
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

export default networks
