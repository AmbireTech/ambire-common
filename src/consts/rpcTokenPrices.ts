import { STK_WALLET, WALLET_TOKEN } from './addresses'

/** A token that isn't traded on its own, but is always worth exactly one of another token */
export type TokenPricedAs = {
  token: string
  /** The token whose price it takes */
  pricedAs: string
}

/** How a DEX factory looks up the pool of two tokens. The values match `PriceGetter.FactoryKind`. */
export enum PoolFactoryKind {
  /** `getPair(tokenA, tokenB)` */
  UniswapV2 = 0,
  /** `getPool(tokenA, tokenB, fee)`, for each of its fees */
  UniswapV3 = 1,
  /** `getPool(tokenA, tokenB, stable)`: Velodrome v2, Aerodrome and their forks */
  Solidly = 2,
  /** `getPool(tokenA, tokenB, tickSpacing)`, for each of its tick spacings: Velodrome's and Aerodrome's concentrated liquidity */
  Slipstream = 3
}

/** A DEX factory, looked up for a token's pools to tell how much liquidity the token has */
export type PoolFactory = {
  factory: string
  kind: PoolFactoryKind
  /** The fees (UniswapV3) or tick spacings (Slipstream) its pools are created with */
  params: number[]
}

/** What pricing tokens other than the native one needs */
export type SpotPriceConfig = {
  /** 1inch's spot price aggregator, which gives each token's rate to the native token */
  oracle: string
  wrappedNative: string
  /** The network's main USD stablecoins, each counted as worth $1 */
  stablecoins: string[]
  /**
   * The factories of the network's main DEXes. A token's liquidity is how much of the wrapped
   * native token or of a stablecoin its pools in these hold, so a token that trades only
   * elsewhere (e.g. Uniswap v4 or Curve) has no price, unless it's one of our curated tokens.
   */
  poolFactories: PoolFactory[]
}

/** What reading token prices from a network's RPC needs */
export type RpcTokenPriceConfig = {
  /**
   * The feed of the native token's USD price: Chainlink's, or another provider's that answers the
   * same way (`latestRoundData` and `decimals`)
   */
  nativeUsdFeed: string
  /**
   * A native token price older than this is not used. The feed's heartbeat (how often it updates
   * when the price doesn't move) plus an hour of slack.
   */
  nativeUsdFeedMaxAgeSeconds: number
  /**
   * How every other token is priced. Without it only the native token (and its wrapped version)
   * is priced.
   */
  spotPrices?: SpotPriceConfig
  /** Tokens priced with another token's price, as no pool trades them */
  tokensPricedAs?: TokenPricedAs[]
}

const SLACK_SECONDS = 60 * 60
const ONE_INCH_SPOT_PRICE_ORACLE = '0x00000000000D6FFc74A8feb35aF5827bf57f6786'
const UNISWAP_V3_FEES = [100, 500, 3000, 10000]
const PANCAKESWAP_V3_FEES = [100, 500, 2500, 10000]
const SLIPSTREAM_TICK_SPACINGS = [1, 10, 50, 100, 200, 2000]
/** The same address on Ethereum, BNB Smart Chain, Arbitrum and Linea */
const PANCAKESWAP_V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'
/** SushiSwap v2's factory on Polygon, Avalanche, Arbitrum and Gnosis, and SushiSwap v3's on Base */
const SUSHISWAP_FACTORY = '0xc35DADB65012eC5796536bD9864eD8773aBc74C4'

const uniswapV2 = (factory: string): PoolFactory => ({
  factory,
  kind: PoolFactoryKind.UniswapV2,
  params: []
})
const uniswapV3 = (factory: string, fees = UNISWAP_V3_FEES): PoolFactory => ({
  factory,
  kind: PoolFactoryKind.UniswapV3,
  params: fees
})
const solidly = (factory: string): PoolFactory => ({
  factory,
  kind: PoolFactoryKind.Solidly,
  params: []
})
const slipstream = (factory: string): PoolFactory => ({
  factory,
  kind: PoolFactoryKind.Slipstream,
  params: SLIPSTREAM_TICK_SPACINGS
})

/**
 * The networks whose token prices can be read from their RPC, keyed by chain id. Checked live
 * when added: the feed answered within its heartbeat and the oracle priced USDC at $1. The pool
 * factories are the ones 1inch's aggregator reads on the network that answer one of the
 * `PoolFactoryKind` lookups, each found to have a pool of the wrapped native token and USDC.
 */
export const RPC_TOKEN_PRICE_CONFIGS: { [chainId: string]: RpcTokenPriceConfig } = {
  // Ethereum, ETH / USD
  '1': {
    nativeUsdFeed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    nativeUsdFeedMaxAgeSeconds: 3600 + SLACK_SECONDS,
    spotPrices: {
      oracle: ONE_INCH_SPOT_PRICE_ORACLE,
      wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      stablecoins: [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        '0x6B175474E89094C44Da98b954EedeAC495271d0F' // DAI
      ],
      poolFactories: [
        uniswapV2('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'), // Uniswap v2
        uniswapV2('0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac'), // SushiSwap
        uniswapV2('0xF14421F0BCf9401d8930872C2d44d8e67e40529a'),
        uniswapV2('0x115934131916C8b277DD010Ee02de363c09d037c'),
        uniswapV3('0x1F98431c8aD98523631AE4a59f267346ea31F984'), // Uniswap v3
        uniswapV3(PANCAKESWAP_V3_FACTORY, PANCAKESWAP_V3_FEES)
      ]
    },
    // Staked WALLET: each stkWALLET is backed by exactly one WALLET in the staking pool
    tokensPricedAs: [{ token: STK_WALLET, pricedAs: WALLET_TOKEN }]
  },
  // Polygon, POL / USD
  '137': {
    nativeUsdFeed: '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0',
    nativeUsdFeedMaxAgeSeconds: 27 + SLACK_SECONDS,
    spotPrices: {
      oracle: ONE_INCH_SPOT_PRICE_ORACLE,
      wrappedNative: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      stablecoins: [
        '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC
        '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' // USDT0
      ],
      poolFactories: [
        uniswapV2('0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32'), // QuickSwap
        uniswapV2(SUSHISWAP_FACTORY),
        uniswapV2('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C'), // Uniswap v2
        uniswapV3('0x1F98431c8aD98523631AE4a59f267346ea31F984') // Uniswap v3
      ]
    }
  },
  // OP Mainnet, ETH / USD
  '10': {
    nativeUsdFeed: '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
    nativeUsdFeedMaxAgeSeconds: 1200 + SLACK_SECONDS,
    spotPrices: {
      oracle: ONE_INCH_SPOT_PRICE_ORACLE,
      wrappedNative: '0x4200000000000000000000000000000000000006',
      stablecoins: [
        '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC
        '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58' // USDT
      ],
      poolFactories: [
        uniswapV2('0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf'), // Uniswap v2
        uniswapV3('0x1F98431c8aD98523631AE4a59f267346ea31F984'), // Uniswap v3
        solidly('0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a'), // Velodrome v2
        slipstream('0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F') // Velodrome Slipstream
      ]
    }
  },
  // Avalanche, AVAX / USD
  '43114': {
    nativeUsdFeed: '0x0A77230d17318075983913bC2145DB16C7366156',
    nativeUsdFeedMaxAgeSeconds: 120 + SLACK_SECONDS,
    spotPrices: {
      oracle: ONE_INCH_SPOT_PRICE_ORACLE,
      wrappedNative: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
      stablecoins: [
        '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // USDC
        '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7' // USDt
      ],
      poolFactories: [
        uniswapV2('0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10'), // Trader Joe
        uniswapV2('0xefa94DE7a4656D787667C749f7E1223D71E9FD88'), // Pangolin
        uniswapV2(SUSHISWAP_FACTORY),
        uniswapV2('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C'), // Uniswap v2
        uniswapV3('0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD') // Uniswap v3
      ]
    }
  },
  // Arbitrum, ETH / USD
  '42161': {
    nativeUsdFeed: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    nativeUsdFeedMaxAgeSeconds: 1755 + SLACK_SECONDS,
    spotPrices: {
      oracle: ONE_INCH_SPOT_PRICE_ORACLE,
      wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      stablecoins: [
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
        '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' // USDT0
      ],
      poolFactories: [
        uniswapV2('0x359F20Ad0F42D75a5077e65F30274cABe6f4F01a'),
        uniswapV2(SUSHISWAP_FACTORY),
        uniswapV2('0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9'), // Uniswap v2
        uniswapV3('0x1F98431c8aD98523631AE4a59f267346ea31F984'), // Uniswap v3
        uniswapV3(PANCAKESWAP_V3_FACTORY, PANCAKESWAP_V3_FEES)
      ]
    }
  },
  // Base, ETH / USD
  '8453': {
    nativeUsdFeed: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
    nativeUsdFeedMaxAgeSeconds: 1200 + SLACK_SECONDS,
    spotPrices: {
      oracle: ONE_INCH_SPOT_PRICE_ORACLE,
      wrappedNative: '0x4200000000000000000000000000000000000006',
      stablecoins: ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'], // USDC
      poolFactories: [
        uniswapV2('0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB'),
        uniswapV2('0x04C9f118d21e8B767D2e50C946f0cC9F6C367300'),
        uniswapV2('0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'), // Uniswap v2
        uniswapV3(SUSHISWAP_FACTORY),
        uniswapV3('0x33128a8fC17869897dcE68Ed026d694621f6FDfD', [100, 400, 500, 3000, 10000]), // Uniswap v3
        uniswapV3('0x3D237AC6D2f425D2E890Cc99198818cc1FA48870', PANCAKESWAP_V3_FEES),
        solidly('0x420DD381b31aEf6683db6B902084cB0FFECe40Da'), // Aerodrome
        slipstream('0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A') // Aerodrome Slipstream
      ]
    }
  },
  // BNB Smart Chain, BNB / USD
  '56': {
    nativeUsdFeed: '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',
    nativeUsdFeedMaxAgeSeconds: 27 + SLACK_SECONDS,
    spotPrices: {
      oracle: ONE_INCH_SPOT_PRICE_ORACLE,
      wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      stablecoins: [
        '0x55d398326f99059fF775485246999027B3197955', // USDT
        '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' // USDC
      ],
      poolFactories: [
        uniswapV2('0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'), // PancakeSwap v2
        uniswapV2('0xBCfCcbde45cE874adCB698cC183deBcF17952812'), // PancakeSwap v1
        uniswapV2('0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6'),
        uniswapV2('0x01bF7C66c6BD861915CdaaE475042d3c4BaE16A7'),
        uniswapV2('0x553990F2CBA90272390f62C5BDb1681fFc899675'),
        uniswapV2('0xaC653cE27E04C6ac565FD87F18128aD33ca03Ba2'),
        uniswapV2('0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'), // Uniswap v2
        uniswapV3('0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7'), // Uniswap v3
        uniswapV3(PANCAKESWAP_V3_FACTORY, PANCAKESWAP_V3_FEES)
      ]
    }
  },
  // Linea, ETH / USD
  '59144': {
    nativeUsdFeed: '0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS,
    spotPrices: {
      oracle: ONE_INCH_SPOT_PRICE_ORACLE,
      wrappedNative: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
      stablecoins: [
        '0x176211869cA2b568f2A7D4EE941E073a821EE1ff', // USDC
        '0xA219439258ca9da29E9Cc4cE5596924745e12B93' // USDT
      ],
      poolFactories: [
        uniswapV2('0xFbc12984689e5f15626Bad03Ad60160Fe98B303C'),
        uniswapV3(
          '0xAAA32926fcE6bE95ea2c51cB4Fcb60836D320C42',
          [100, 250, 500, 3000, 5000, 10000, 20000]
        ),
        uniswapV3(PANCAKESWAP_V3_FACTORY, PANCAKESWAP_V3_FEES)
      ]
    }
  },
  // Unichain, ETH / USD
  '130': {
    nativeUsdFeed: '0xBcE70e194940a157f3A80566505a7E96f5238CCa',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS,
    spotPrices: {
      oracle: ONE_INCH_SPOT_PRICE_ORACLE,
      wrappedNative: '0x4200000000000000000000000000000000000006',
      stablecoins: [
        '0x078D782b760474a361dDA0AF3839290b0EF57AD6', // USDC
        '0x9151434b16b9763660705744891fA906F660EcC5' // USDT0
      ],
      poolFactories: [
        uniswapV2('0x1F98400000000000000000000000000000000002'), // Uniswap v2
        uniswapV3('0x1F98400000000000000000000000000000000003') // Uniswap v3
      ]
    }
  },
  // Gnosis, DAI / USD, as xDAI is bridged DAI
  '100': {
    nativeUsdFeed: '0x678df3415fc31947dA4324eC63212874be5a82f8',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS,
    spotPrices: {
      oracle: ONE_INCH_SPOT_PRICE_ORACLE,
      wrappedNative: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d',
      stablecoins: [
        '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83', // USDC
        '0x4ECaBa5870353805a9F068101A40E0f32ed605C6' // USDT
      ],
      poolFactories: [
        uniswapV2('0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7'), // Honeyswap
        uniswapV2('0x965769C9CeA8A7667246058504dcdcDb1E2975A5'),
        uniswapV2('0x5D48C95AdfFD4B40c1AAADc4e08fc44117E02179'), // Swapr
        uniswapV2(SUSHISWAP_FACTORY)
      ]
    }
  },
  // Sonic, S / USD
  '146': {
    nativeUsdFeed: '0xc76dFb89fF298145b417d221B2c747d84952e01d',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS,
    spotPrices: {
      oracle: ONE_INCH_SPOT_PRICE_ORACLE,
      wrappedNative: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',
      stablecoins: [
        '0x29219dd400f2Bf60E5a23d13Be72B486D4038894', // USDC
        '0x6047828dc181963ba44974801FF68e538dA5eaF9' // USDT
      ],
      poolFactories: [
        uniswapV3('0xcb2436774C3e191c85056d248EF4260ce5f27A9D'),
        uniswapV3('0x56CFC796bC88C9c7e1b38C2b0aF9B7120B079aef', [500, 3000, 10000])
      ]
    }
  },
  // Ink, ETH / USD. 1inch's aggregator isn't deployed here.
  '57073': {
    nativeUsdFeed: '0x963d5d3aD2Dfd3fe759d376fF62A0963176DBdF5',
    nativeUsdFeedMaxAgeSeconds: 3600 + SLACK_SECONDS
  },
  // Robinhood Chain, ETH / USD. 1inch's aggregator isn't deployed here.
  '4663': {
    nativeUsdFeed: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS
  },
  // Celo, CELO / USD. 1inch's aggregator isn't deployed here.
  '42220': {
    nativeUsdFeed: '0x0568fD19986748cEfF3301e55c0eb1E729E0Ab7e',
    nativeUsdFeedMaxAgeSeconds: 240 + SLACK_SECONDS
  },
  // Metis, METIS / USD. 1inch's aggregator isn't deployed here.
  '1088': {
    nativeUsdFeed: '0xD4a5Bb03B5D66d9bf81507379302Ac2C2DFDFa6D',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS
  },
  // HyperEVM, HYPE / USD. 1inch's aggregator isn't deployed here.
  '999': {
    nativeUsdFeed: '0xa5a72eF19F82A579431186402425593a559ed352',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS
  },
  // Monad, MON / USD. 1inch's aggregator isn't deployed here.
  '143': {
    nativeUsdFeed: '0xBcD78f76005B7515837af6b50c7C52BCf73822fb',
    nativeUsdFeedMaxAgeSeconds: 3600 + SLACK_SECONDS
  },
  // MegaETH, ETH / USD. 1inch's aggregator isn't deployed here.
  '4326': {
    nativeUsdFeed: '0xcA4e254D95637DE95E2a2F79244b03380d697feD',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS
  },
  // Plasma, XPL / USD. 1inch's aggregator isn't deployed here.
  '9745': {
    nativeUsdFeed: '0xF932477C37715aE6657Ab884414Bd9876FE3f750',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS
  },
  // Katana, ETH / USD. 1inch's aggregator isn't deployed here.
  '747474': {
    nativeUsdFeed: '0x7BdBDB772f4a073BadD676A567C6ED82049a8eEE',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS
  },
  // Arc, USDC / USD, as its native token is USDC. 1inch's aggregator isn't deployed here.
  '5042': {
    nativeUsdFeed: '0x84EA90AC252Dc437031461836DB5164219147905',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS
  },
  // Berachain, BERA / USD from RedStone (multi-feed). 1inch's aggregator isn't deployed here.
  '80094': {
    nativeUsdFeed: '0x29d2fEC890B037B2d34f061F9a50f76F85ddBcAE',
    nativeUsdFeedMaxAgeSeconds: 21600 + SLACK_SECONDS
  },
  // Etherlink, XTZ / USD from RedStone, updated every few seconds. 1inch's aggregator isn't
  // deployed here.
  '42793': {
    nativeUsdFeed: '0xe92c00BC72dD12e26E61212c04E8D93aa09624F2',
    nativeUsdFeedMaxAgeSeconds: SLACK_SECONDS
  },
  // Somnia, SOMI / USD from API3. 1inch's aggregator isn't deployed here.
  '5031': {
    nativeUsdFeed: '0x3fCD429c7b492Be06066DA84E9885c720a2B71c2',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS
  },
  // Citrea, BTC / USD from RedStone (multi-feed), as cBTC is pegged to BTC. 1inch's aggregator
  // isn't deployed here.
  '4114': {
    nativeUsdFeed: '0xc555c100DB24dF36D406243642C169CC5A937f09',
    nativeUsdFeedMaxAgeSeconds: 21600 + SLACK_SECONDS
  },
  // Kaia, KAIA / USD from RedStone (multi-feed). 1inch's aggregator isn't deployed here.
  '8217': {
    nativeUsdFeed: '0xa2F3430ac9cfc37aEF88449DADf36af676211A64',
    nativeUsdFeedMaxAgeSeconds: 43200 + SLACK_SECONDS
  },
  // Scroll, ETH / USD. 1inch's aggregator isn't deployed here.
  '534352': {
    nativeUsdFeed: '0x6bF14CB0A831078629D993FDeBcB182b21A8774C',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS
  },
  // Mantle, MNT / USD. 1inch's aggregator isn't deployed here.
  '5000': {
    nativeUsdFeed: '0xD97F20bEbeD74e8144134C4b148fE93417dd0F96',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS
  }
}

/** The config for reading token prices from the network's RPC, if the network has one */
export const getRpcTokenPriceConfig = (chainId: bigint): RpcTokenPriceConfig | undefined =>
  RPC_TOKEN_PRICE_CONFIGS[chainId.toString()]
