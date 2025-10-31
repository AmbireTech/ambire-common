export const dappIdsToBeRemoved = new Set([
  'legends.ambire.com', // Remove legends from the list as it was replaced with rewards.ambire.com
  'yearn.finance', // Remove the legacy Yarn Finance URL from the list
  'getpass.civic.com', // Civic Pass got shut down
  'mean.finance', // Mean Finance became Balmy, but Balmy got shut down
  'polygon.lido.fi', // Lido Polygon staking was sunset on June 16th 2025
  'kwenta.io', // Synthetix acquired Kwenta
  'pro.opensea.io', // Open Sea Pro is no longer on e separate domain
  'app.paraswap.io', // ParaSwap rebranded to Velora
  'snapshot.org', // snapshot.org became snapshot.box
  'play.decentraland.org', // play.decentraland.org redirects to decentraland.org
  'bridge.arbitrum.io', // bridge.arbitrum.io was moved to portal.arbitrum.io
  'curve.fi', // curve.fi was moved to curve.finance
  'app.ether.fi', // app.ether.fi was moved to ether.fi
  'core.app', // not supported,
  'bridge.base.org'
])

export const featuredDapps = new Set([
  'rewards.ambire.com',
  'snapshot.box/#/s:ambire.eth',
  'aave.com',
  'lido.fi',
  'uniswap.org',
  'bitrefill.com',
  'altitude.fi'
])

export const predefinedDapps = [
  {
    id: 'rewards.ambire.com',
    url: 'https://rewards.ambire.com',
    name: 'Ambire Rewards',
    icon: 'https://rewards.ambire.com/ambire-connect-icon.png',
    description: 'Complete quests, earn XP and climb the leaderboard to secure Ambire rewards.',
    chainIds: [1, 8453, 10, 42161, 534352, 56],
    twitter: 'ambire'
  },
  {
    id: 'snapshot.box/#/s:ambire.eth',
    url: 'https://snapshot.box/#/s:ambire.eth',
    name: 'Ambire Governance',
    icon: 'https://cdn.stamp.fyi/space/s:ambire.eth?s=72&cb=4b611281a79dbb15',
    description: 'Vote on Ambire Wallet DAO proposals.',
    chainIds: [1],
    category: 'Services',
    twitter: 'ambire'
  },
  {
    id: 'bitrefill.com',
    url: 'https://www.bitrefill.com',
    name: 'Bitrefill',
    icon: 'https://www.bitrefill.com/android-chrome-192x192.png',
    description: 'The crypto store for digital gift cards, eSIMs, and phone refills.',
    chains: [1, 137],
    category: 'Payments',
    twitter: 'bitrefill'
  },
  {
    id: 'snapshot.box',
    url: 'https://snapshot.box',
    name: 'Snapshot',
    icon: 'https://icons.llama.fi/snapshot.png',
    description:
      'Snapshot is an off-chain voting platform that allows DAOs, DeFi protocols, or NFT communities to participate in the decentralized governance easily and without gas fees.',
    category: 'Services',
    twitter: 'SnapshotLabs'
  },
  {
    id: 'guild.xyz',
    url: 'https://guild.xyz',
    name: 'Guild',
    icon: 'https://static.debank.com/image/project/logo_url/guild/1553e3322e5d5a04a91ce424f63c02b3.png',
    description: 'Automated membership management for the platforms your community already uses.',
    category: 'Social',
    twitter: 'guildxyz'
  },
  {
    id: 'opensea.io',
    url: 'https://opensea.io',
    name: 'OpenSea',
    icon: 'https://static.debank.com/image/project/logo_url/opensea/4b23246fac2d4ce53bd8e8079844821c.png',
    description:
      "OpenSea is the world's first and largest web3 marketplace for NFTs and crypto collectibles. Browse, create, buy, sell, and auction NFTs using OpenSea today.",
    category: 'NFT Marketplace',
    twitter: 'opensea'
  },
  {
    id: 'decentraland.org',
    url: 'https://decentraland.org',
    name: 'Decentraland',
    icon: 'https://static.debank.com/image/project/logo_url/decentraland/449a5d002f7099af8320c9ea0e3d34c1.png',
    description: 'Create, explore and trade in the first-ever virtual world owned by its users.',
    category: 'Metaverse',
    twitter: 'decentraland'
  },
  {
    id: 'spooky.fi',
    url: 'https://spooky.fi',
    name: 'SpookySwap',
    icon: 'https://static.debank.com/image/project/logo_url/ftm_spookyswap/d14381e7154b7cfecaa8ba7887e73b95.png',
    description: 'Farm BOO with Spooky LP Tokens',
    category: 'Dexs',
    chains: [250, 199, 146, 7332],
    twitter: 'SpookySwap'
  },
  {
    id: 'looksrare.org',
    url: 'https://looksrare.org',
    name: 'LooksRare',
    icon: 'https://static.debank.com/image/project/logo_url/looksrare/45d6664429880a23ba34359c45bab95e.png',
    description: 'Buy & Sell NFTs, Get Rewards',
    category: 'NFT Marketplace',
    chains: [1],
    twitter: 'LooksRareNFT'
  },
  {
    id: 'kyberswap.com',
    url: 'https://kyberswap.com',
    name: 'KyberSwap',
    icon: 'https://static.debank.com/image/project/logo_url/dmm_exchange/62bd3271bf61c97fbb342203f47b2de1.png',
    description:
      'KyberSwap is a multi-chain aggregator and DeFi hub that empowers users with the insights and tools to achieve financial autonomy. All the above while being fast, secure, and easy-to-use.',
    twitter: 'KyberNetwork',
    category: 'Dexes'
  },
  {
    id: 'app.debridge.finance',
    url: 'https://app.debridge.finance',
    name: 'deBridge',
    icon: 'https://static.debank.com/image/project/logo_url/arb_debridge/6cfd59d36a4a6c077623960a384ca889.png',
    description: 'Interoperability for High Performance dApps',
    twitter: 'deBridgeFinance',
    category: 'Cross-Chain'
  },
  {
    id: 'socialscan.io',
    url: 'https://socialscan.io',
    name: 'SocialScan',
    icon: 'https://static.debank.com/image/project/logo_url/socialscan/b0001be374c286ff297a8a4614f73e8d.png',
    description:
      'SocialScan transforms web3 discovery with its AI-powered, community-native platform, providing a comprehensive, real-time view of assets, communities, and members across the web3 ecosystem.',
    twitter: 'SocialScan_io',
    category: 'Analytics'
  },
  {
    id: 'matcha.xyz',
    url: 'https://matcha.xyz',
    name: 'Matcha',
    icon: 'https://static.debank.com/image/project/logo_url/matcha/35fce9290caf372e1975cdf5edbafa17.png',
    description:
      'Matcha DEX aggregator | Search and trade over +5 million tokens across +100 exchanges on 9 chains. Trade now.',
    twitter: 'matchaxyz',
    category: 'Dexes'
  },
  {
    id: 'rarible.com',
    url: 'https://rarible.com',
    name: 'Rarible',
    icon: 'https://static.debank.com/image/project/logo_url/rarible/9dccccce16996e5dfaa40ba6a18e2542.png',
    description:
      'Discover, sell and buy NFTs on Rarible! Our aggregated NFT marketplace for Ethereum NFTs and Polygon NFTs powers brands, collections and creator marketplaces.',
    twitter: 'rarible',
    category: 'NFT Marketplace'
  },
  {
    id: 'mirror.xyz',
    url: 'https://mirror.xyz',
    name: 'Mirror',
    icon: 'https://static.debank.com/image/project/logo_url/mirrorxyz/728ae5326b3306d3688b218c36a1db2a.png',
    description:
      'Built on web3 for web3, Mirror’s robust publishing platform pushes the boundaries of writing online—whether it’s the next big white paper or a weekly community update.',
    twitter: 'mirror_xyz',
    category: 'Social'
  },
  {
    id: 'app.ens.domains',
    url: 'https://app.ens.domains',
    name: 'ENS',
    icon: 'https://static.debank.com/image/project/logo_url/ens/bdf7931c546313b4e1e6c20f82b4f183.png',
    description: 'Decentralized naming for wallets, websites, & more.',
    twitter: 'ensdomains',
    category: 'Domain Services'
  }
]

export const defiLlamaProtocolIdsToExclude: string[] = [
  '1624' // https://www.ambire.com
]

export const categoriesNotToFilterOut = ['DEX Aggregator']
export const dappsNotToFilterOutByDomain = ['snapshot.box']
