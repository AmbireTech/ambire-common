import { Session } from '../classes/session'
import { ControllerInterface } from './controller'
import { BlacklistedStatus } from './phishing'

export type IDappsController = ControllerInterface<
  InstanceType<typeof import('../controllers/dapps/dapps').DappsController>
>

export interface DappAccountPreferences {
  enabled: boolean
  /**
   * The last selected account in the extension when the dapp session was active. It is used
   * when the currently selected account in the extension is not a part of the `accounts` list.
   * If the currently selected account in the extension is a prat of the list, this field is ignored and the current account is used instead.
   */
  selectedAccount: string
  accounts: string[]
}

export interface PredefinedDapp {
  id: string
  name: string
  description: string
  url: string
  icon: string | null
}

export type ConnectionSource = 'injected' | 'wc'

export interface ExtraDappInfo {
  /**
   * The chainId of the app when connected
   */
  chainId: number
  category: string | null
  tvl: number | null
  twitter: string | null
  geckoId: string | null
  chainIds: number[]
  /**
   * Derived from `connectedSources.length > 0`. Kept on the serialized output for back-compat
   * with UI code that reads `dapp.isConnected`. Not persisted as the source of truth — the
   * source of truth is `connectedSources`.
   */
  isConnected: boolean
  /**
   * Active connection channels for this dapp. On web/extension this is always either
   * `[]` or `['injected']`. On mobile it may contain `'injected'`, `'wc'`, or both.
   */
  connectedSources: ConnectionSource[]
  isFeatured: boolean
  isCustom: boolean
  favorite: boolean
  blacklisted: BlacklistedStatus
  grantedPermissionId?: string
  accountPreferences?: DappAccountPreferences
  grantedPermissionAt?: number
}

export type Dapp = PredefinedDapp & Partial<ExtraDappInfo>

export interface RecentDappEntry {
  id: string
  openedAt: number
}

// Raw shape of a single item returned by the cena trending tokens endpoint
// (https://cena.ambire.com/api/v3/trending/). Only the fields the wallet consumes are typed;
// the endpoint returns more (sparkline, btc-denominated values, etc.) that we ignore.
export interface RawTrendingToken {
  id: string
  name: string
  symbol: string
  market_cap_rank: number | null
  thumb: string
  small: string
  large: string
  // Primary CoinGecko asset platform (e.g. 'ethereum') plus the per-platform contract addresses
  // and decimals. Used to reuse the portfolio token-details components and match held balances.
  asset_platform_id?: string | null
  contract_address?: string
  platforms?: { [platform: string]: string }
  decimals?: { [platform: string]: number }
  detail_platforms?: { [platform: string]: { decimal_place: number; contract_address: string } }
  links?: { homepage?: string[] }
  // Exchanges the token is traded on. We only read the CoinGecko exchange identifier.
  tickers?: { market?: { identifier?: string } }[]
  // Fresh coin-detail USD values (flat). Preferred over the `data` block below, which is the
  // trending-widget snapshot and can be stale.
  usd?: number
  usd_24h_change?: number
  usd_market_cap?: number
  usd_24h_vol?: number
  usd_fully_diluted_valuation?: number
  total_supply?: number
  description?: { en?: string } | null
  data?: {
    price?: number
    // Percentage change keyed by fiat/crypto currency (usd, eur, btc, ...). We only read `usd`.
    price_change_percentage_24h?: { [currency: string]: number }
    // Pre-formatted, currency-prefixed strings from the server (e.g. "$74,041,107").
    market_cap?: string
    total_volume?: string
    content?: { title: string; description: string } | null
  }
}

// Normalized trending token kept in the DappsController state and rendered by the UI.
export interface TrendingToken {
  // CoinGecko id (e.g. 'zignaly'); stable, used as the list key and details-screen lookup id.
  id: string
  name: string
  symbol: string
  icon: string
  priceUSD: number
  priceChange24hUSD: number | null
  marketCapRank: number | null
  description: string | null
  // Contract of the token on its primary CoinGecko asset platform, and that platform's CoinGecko
  // id (e.g. 'ethereum'). Used to derive the chainId, resolve the token icon and match a held
  // balance in the account portfolio. Null when the token has no on-chain contract (e.g. BTC).
  address: string | null
  platformId: string | null
  decimals: number | null
  // USD market data, mapped into the same numeric fields the portfolio "About" section reads.
  marketCapUSD: number | null
  totalVolumeUSD: number | null
  fullyDilutedValuationUSD: number | null
  totalSupply: number | null
  website: string | null
  // CoinGecko exchange ids the token is traded on; resolved against the PortfolioController's
  // exchange registry when rendering the supported-exchanges row.
  exchangeIds: string[]
}

export interface DefiLlamaProtocol {
  id: string
  name: string
  symbol: string
  description: string
  logo: string
  gecko_id: string | null
  url: string
  address: string | null
  twitter: string
  category: string
  chains: string[]
  tvl: number | null
  chainTvls: { [key: string]: number }
  change_1d: number | null
  change_1h: number | null
  change_7d: number | null
}

export interface DefiLlamaChain {
  gecko_id: string | null
  tvl: number
  tokenSymbol: string | null
  cmcId: string | null
  name: string
  chainId: number | null
}

export interface DappProviderRequest {
  method: string
  params?: any
  session: Session
  meta?: { [key: string]: any }
}

export interface GetCurrentDappRes {
  type: string
  requestId: string
  ok: boolean
  res: Dapp | null
}

export interface HasUnverifiedDappsRes {
  type: string
  requestId: string
  ok: boolean
  res: boolean
}

export type DappVerificationBanner = {
  id: string
  type: 'error' | 'warning'
  text: string
}

export const DAPP_VERIFICATION_BANNER_IDS = {
  LOADING: 'dapp-verification-loading-banner',
  FAILED_TO_GET_OR_UNKNOWN: 'dapp-verification-failed-banner',
  BLACKLISTED: 'dapp-verification-blacklisted-banner',
  SUSPICIOUS_HOSTING: 'dapp-verification-suspicious-hosting-banner',
  NOT_IN_CATALOG: 'dapp-verification-not-in-catalog-banner'
} as const
