export interface Dapp {
  id: string
  name: string
  description: string
  url: string
  icon: string | null
  isConnected: boolean
  chainId: number
  favorite: boolean
  blacklisted?: boolean
  grantedPermissionId?: string
  grantedPermissionAt?: number
}

export interface DappProviderRequest {
  method: string
  params?: any
  session: { id: string; origin: string; name: string; icon: string }
  origin: string
  meta?: { [key: string]: any }
}
