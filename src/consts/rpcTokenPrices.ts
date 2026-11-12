/** What reading token prices from a network's RPC needs */
export type RpcTokenPriceConfig = {
  /** The Chainlink feed of the native token's USD price */
  nativeUsdFeed: string
  /**
   * A native token price older than this is not used. The feed's heartbeat (how often it updates
   * when the price doesn't move) plus an hour of slack.
   */
  nativeUsdFeedMaxAgeSeconds: number
  /**
   * 1inch's spot price aggregator, which prices every other token. Without it only the native
   * token (and its wrapped version) is priced.
   */
  spotPriceOracle?: string
}

const SLACK_SECONDS = 60 * 60
const ONE_INCH_SPOT_PRICE_ORACLE = '0x00000000000D6FFc74A8feb35aF5827bf57f6786'

/**
 * The networks whose token prices can be read from their RPC, keyed by chain id. Checked live
 * when added: the feed answered within its heartbeat and the oracle priced USDC at $1.
 */
export const RPC_TOKEN_PRICE_CONFIGS: { [chainId: string]: RpcTokenPriceConfig } = {
  // Ethereum, ETH / USD
  '1': {
    nativeUsdFeed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    nativeUsdFeedMaxAgeSeconds: 3600 + SLACK_SECONDS,
    spotPriceOracle: ONE_INCH_SPOT_PRICE_ORACLE
  },
  // Polygon, POL / USD
  '137': {
    nativeUsdFeed: '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0',
    nativeUsdFeedMaxAgeSeconds: 27 + SLACK_SECONDS,
    spotPriceOracle: ONE_INCH_SPOT_PRICE_ORACLE
  },
  // OP Mainnet, ETH / USD
  '10': {
    nativeUsdFeed: '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
    nativeUsdFeedMaxAgeSeconds: 1200 + SLACK_SECONDS,
    spotPriceOracle: ONE_INCH_SPOT_PRICE_ORACLE
  },
  // Avalanche, AVAX / USD
  '43114': {
    nativeUsdFeed: '0x0A77230d17318075983913bC2145DB16C7366156',
    nativeUsdFeedMaxAgeSeconds: 120 + SLACK_SECONDS,
    spotPriceOracle: ONE_INCH_SPOT_PRICE_ORACLE
  },
  // Arbitrum, ETH / USD
  '42161': {
    nativeUsdFeed: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    nativeUsdFeedMaxAgeSeconds: 1755 + SLACK_SECONDS,
    spotPriceOracle: ONE_INCH_SPOT_PRICE_ORACLE
  },
  // Base, ETH / USD
  '8453': {
    nativeUsdFeed: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
    nativeUsdFeedMaxAgeSeconds: 1200 + SLACK_SECONDS,
    spotPriceOracle: ONE_INCH_SPOT_PRICE_ORACLE
  },
  // BNB Smart Chain, BNB / USD
  '56': {
    nativeUsdFeed: '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',
    nativeUsdFeedMaxAgeSeconds: 27 + SLACK_SECONDS,
    spotPriceOracle: ONE_INCH_SPOT_PRICE_ORACLE
  },
  // Linea, ETH / USD
  '59144': {
    nativeUsdFeed: '0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS,
    spotPriceOracle: ONE_INCH_SPOT_PRICE_ORACLE
  },
  // Unichain, ETH / USD
  '130': {
    nativeUsdFeed: '0xBcE70e194940a157f3A80566505a7E96f5238CCa',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS,
    spotPriceOracle: ONE_INCH_SPOT_PRICE_ORACLE
  },
  // Gnosis, DAI / USD, as xDAI is bridged DAI
  '100': {
    nativeUsdFeed: '0x678df3415fc31947dA4324eC63212874be5a82f8',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS,
    spotPriceOracle: ONE_INCH_SPOT_PRICE_ORACLE
  },
  // Sonic, S / USD
  '146': {
    nativeUsdFeed: '0xc76dFb89fF298145b417d221B2c747d84952e01d',
    nativeUsdFeedMaxAgeSeconds: 86400 + SLACK_SECONDS,
    spotPriceOracle: ONE_INCH_SPOT_PRICE_ORACLE
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
