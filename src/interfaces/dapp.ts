import { Session } from '../classes/session'
import { ControllerInterface } from './controller'
import { BlacklistedStatus } from './phishing'

export type IDappsController = ControllerInterface<
  InstanceType<typeof import('../controllers/dapps/dapps').DappsController>
>

export interface PredefinedDapp {
  id: string
  name: string
  description: string
  url: string
  icon: string | null
}

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
  isConnected: boolean
  isFeatured: boolean
  isCustom: boolean
  favorite: boolean
  blacklisted: BlacklistedStatus
  grantedPermissionId?: string
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
  NOT_IN_CATALOG: 'dapp-verification-not-in-catalog-banner'
} as const
