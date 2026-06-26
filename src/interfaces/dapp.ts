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
