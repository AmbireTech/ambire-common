export type CowSwapOrderStatus =
  | 'presignaturePending'
  | 'open'
  | 'fulfilled'
  | 'cancelled'
  | 'expired'

export type CowSwapOrderResponse = {
  status: CowSwapOrderStatus
}

export type CowSwapTrade = {
  txHash?: string | null
}

export type CowSwapErrorResponse = {
  errorType?: string
  description?: string
  message?: string
}

export type CowSwapTokenListEntry = {
  address: string
  chainId: number
  decimals: number
  logoURI?: string
  name: string
  symbol: string
}

export type CenaPlatformResponse = {
  platformId?: string
}

export type CenaTokenResponse = {
  blacklist?: boolean
  decimals?: Record<string, number>
  image?: {
    large?: string
    small?: string
    thumb?: string
  }
  name?: string
  platforms?: Record<string, string>
  removed?: boolean
  symbol?: string
}
