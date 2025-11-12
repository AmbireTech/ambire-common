import { Session } from '../classes/session'
import { ControllerInterface } from './controller'

export type IDappsController = ControllerInterface<
  InstanceType<typeof import('../controllers/dapps/dapps').DappsController>
>

export interface Dapp {
  id: string
  name: string
  description: string
  url: string
  icon: string | null
  category: string | null
  tvl: number | null
  twitter: string | null
  geckoId: string | null
  chainIds: number[]
  isConnected: boolean
  isFeatured: boolean
  isCustom: boolean
  chainId: number
  favorite: boolean
  blacklisted: 'LOADING' | 'FAILED_TO_GET' | 'BLACKLISTED' | 'NOT_BLACKLISTED'
  grantedPermissionId?: string
  grantedPermissionAt?: number
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
  gecko_id: string
  tvl: number
  tokenSymbol: string
  cmcId: string
  name: string
  chainId: number
}

export interface DappProviderRequest {
  method: string
  params?: any
  session: Session
  meta?: { [key: string]: any }
}
