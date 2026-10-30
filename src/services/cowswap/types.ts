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
