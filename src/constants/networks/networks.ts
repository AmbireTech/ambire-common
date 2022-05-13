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
  'aurora' = 'aurora'
}

export type NetworkId = keyof typeof NETWORKS

export type NetworkType = {
  id: NetworkId
  chainId: number
  rpc: string
  nativeAssetSymbol: string
  name: string
  explorerUrl: string
  unstoppableDomainsChain: string
}

const networks: NetworkType[] = [
  {
    id: NETWORKS.ethereum,
    chainId: 1,
    //rpc: 'https://mainnet.infura.io/v3/3d22938fd7dd41b7af4197752f83e8a1',
    //rpc: 'https://morning-wild-water.quiknode.pro/66011d2c6bdebc583cade5365086c8304c13366c/',
    //rpc: 'https://mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae',
    rpc: 'https://eth-mainnet.alchemyapi.io/v2/e5Gr8LP_EH0SBPZiNCcC08OuEDrvgoYK',
    nativeAssetSymbol: 'ETH',
    name: 'Ethereum',
    explorerUrl: 'https://etherscan.io',
    unstoppableDomainsChain: 'ERC20'
  },
  {
    id: NETWORKS.polygon,
    chainId: 137,
    rpc: 'https://polygon-rpc.com/rpc',
    // rpc: 'https://polygon-mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae',
    nativeAssetSymbol: 'MATIC',
    name: 'Polygon',
    explorerUrl: 'https://polygonscan.com',
    unstoppableDomainsChain: 'MATIC'
  },
  {
    id: NETWORKS.avalanche,
    chainId: 43114,
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    nativeAssetSymbol: 'AVAX',
    name: 'Avalanche',
    explorerUrl: 'https://snowtrace.io',
    unstoppableDomainsChain: 'ERC20'
  },
  {
    // to match the zapper ID
    id: NETWORKS['binance-smart-chain'],
    chainId: 56,
    rpc: 'https://bsc-dataseed1.defibit.io',
    nativeAssetSymbol: 'BNB',
    name: 'Binance Smart Chain',
    explorerUrl: 'https://bscscan.com',
    unstoppableDomainsChain: 'BEP20'
  },
  {
    id: NETWORKS.fantom,
    chainId: 250,
    rpc: 'https://rpc.ftm.tools',
    nativeAssetSymbol: 'FTM',
    name: 'Fantom Opera',
    explorerUrl: 'https://ftmscan.com',
    unstoppableDomainsChain: 'ERC20'
  },
  {
    id: NETWORKS.moonbeam,
    chainId: 1284,
    rpc: 'https://rpc.api.moonbeam.network',
    nativeAssetSymbol: 'GLMR',
    name: 'Moonbeam',
    explorerUrl: 'https://moonscan.io/',
    unstoppableDomainsChain: 'ERC20'
  },
  {
    id: NETWORKS.moonriver,
    chainId: 1285,
    rpc: 'https://rpc.api.moonriver.moonbeam.network',
    nativeAssetSymbol: 'MOVR',
    name: 'Moonriver',
    explorerUrl: 'https://moonriver.moonscan.io/',
    unstoppableDomainsChain: 'ERC20'
  },
  // {
  // 	id: NETWORKS.arbitrum,
  // 	chainId: 42161,
  // 	rpc: 'https://arb1.arbitrum.io/rpc',
  // 	nativeAssetSymbol: 'AETH',
  // 	name: 'Arbitrum',
  // 	explorerUrl: 'https://arbiscan.io',
  // 	unstoppableDomainsChain: 'ERC20'
  // },
  {
    id: NETWORKS.gnosis,
    chainId: 100,
    rpc: 'https://rpc.xdaichain.com',
    nativeAssetSymbol: 'XDAI',
    name: 'Gnosis Chain',
    explorerUrl: 'https://blockscout.com',
    unstoppableDomainsChain: 'ERC20'
  },
  {
    id: NETWORKS.kucoin,
    chainId: 321,
    rpc: 'https://rpc-mainnet.kcc.network',
    nativeAssetSymbol: 'KCS',
    name: 'KCC KuCoin',
    explorerUrl: 'https://explorer.kcc.io',
    unstoppableDomainsChain: 'ERC20'
  },
  {
    id: NETWORKS.optimism,
    chainId: 10,
    rpc: 'https://mainnet.optimism.io',
    nativeAssetSymbol: 'ETH',
    name: 'Optimism',
    explorerUrl: 'https://optimistic.etherscan.io',
    unstoppableDomainsChain: 'ERC20'
  }
  // {
  // 	id: NETWORKS.andromeda,
  // 	chainId: 1088,
  // 	rpc: 'https://andromeda.metis.io/?owner=1088',
  // 	nativeAssetSymbol: 'METIS',
  // 	name: 'Andromeda',
  // 	explorerUrl: 'https://andromeda-explorer.metis.io',
  // 	unstoppableDomainsChain: 'ERC20'
  // },
  // {
  // 	id: NETWORKS.cronos,
  // 	chainId: 25,
  // 	rpc: 'https://evm-cronos.crypto.org',
  // 	nativeAssetSymbol: 'CRO',
  // 	name: 'Cronos',
  // 	explorerUrl: 'https://cronoscan.com',
  // 	unstoppableDomainsChain: 'ERC20'
  // },
  // {
  // 	id: NETWORKS.aurora,
  // 	chainId: 1313161554,
  // 	rpc: 'https://mainnet.aurora.dev',
  // 	nativeAssetSymbol: 'ETH',
  // 	name: 'NEAR Aurora',
  // 	explorerUrl: 'https://aurorascan.dev',
  // 	unstoppableDomainsChain: 'ERC20'
  // }
]

export default networks
