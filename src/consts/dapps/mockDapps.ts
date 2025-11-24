import { DefiLlamaProtocol } from 'interfaces/dapp'

const testDapps: DefiLlamaProtocol[] = [
  {
    id: '2269',
    name: 'Binance CEX',
    address: null,
    symbol: '-',
    url: 'https://www.binance.com',
    description:
      'Binance is a cryptocurrency exchange which is the largest exchange in the world in terms of daily trading volume of cryptocurrencies',
    logo: 'https://icons.llama.fi/binance-cex.jpg',
    gecko_id: null,
    category: 'CEX',
    chains: ['Ethereum', 'Bitcoin', 'Base', 'Optimism'],
    twitter: 'binance',
    tvl: 162476627222.4452,
    chainTvls: {
      Base: 602939156.2670949,
      Optimism: 152749750.35426122,
      Ethereum: 62040063990.6362,
      Bitcoin: 49736720881.04051
    },
    change_1h: -0.43624943841368236,
    change_1d: -6.928359190398993,
    change_7d: -9.220239032701798
  },
  {
    id: '1599',
    name: 'Aave V3',
    address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    symbol: 'AAVE',
    url: 'https://aave.com',
    description: 'Earn interest, borrow assets, and build applications',
    logo: 'https://icons.llama.fi/aave-v3.png',
    gecko_id: null,
    category: 'Lending',
    chains: ['Ethereum', 'Base', 'Optimism'],
    twitter: 'aave',
    tvl: 29961368127.031742,
    chainTvls: {
      Base: 794905550.8742671,
      Optimism: 89608421.4725273,
      Ethereum: 24582418395.426888
    },
    change_1h: -1.7098807967804959,
    change_1d: -5.422309641003608,
    change_7d: -9.762996384613004
  },
  {
    id: '182',
    name: 'Lido',
    address: '0x5a98fcbea516cf06857215779fd812ca3bef1b32',
    symbol: 'LDO',
    url: 'https://lido.fi/',
    description: 'Liquid staking for Ethereum and Polygon. Daily staking rewards, no lock ups.',
    logo: 'https://icons.llama.fi/lido.png',
    category: 'Liquid Staking',
    chains: ['Ethereum', 'Solana', 'Moonbeam', 'Moonriver', 'Terra'],
    twitter: 'LidoFinance',
    gecko_id: null,
    tvl: 23533672445.567448,
    chainTvls: {
      Terra: 0,
      Ethereum: 23526870477.792473,
      Solana: 6711595.319141103,
      Moonriver: 21064.84136312399,
      Moonbeam: 69307.61447010032
    },
    change_1h: -1.3296649356605883,
    change_1d: -10.268104326910262,
    change_7d: -14.764134932686503
  },
  {
    id: '2',
    name: 'WBTC',
    address: null,
    symbol: '-',
    url: 'https://wbtc.network/',
    description:
      'Wrapped Bitcoin (WBTC) is the first ERC20 token backed 1:1 with Bitcoin.Completely transparent. 100% verifiable. Community led.',
    logo: 'https://icons.llama.fi/wbtc.png',
    gecko_id: null,
    category: 'Bridge',
    chains: ['Bitcoin'],
    twitter: 'WrappedBTC',
    tvl: 10426414372.129347,
    chainTvls: {
      Bitcoin: 10426414372.129347
    },
    change_1h: -1.174261412680849,
    change_1d: -9.874485379564277,
    change_7d: -14.54967690988093
  }
]

export default testDapps
