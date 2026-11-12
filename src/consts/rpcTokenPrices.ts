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
