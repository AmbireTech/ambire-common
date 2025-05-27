export interface Dapp {
  name: string
  description: string
  url: string
  icon: string | null
  isConnected: boolean
  chainId: number
  favorite: boolean
  blacklisted?: boolean
}

export interface DappProviderRequest {
  method: string
  params?: any
  session: { name: string; origin: string; icon: string }
  origin: string
  meta?: { [key: string]: any }
}
