export type CowSwapOrderStatus =
  | 'presignaturePending'
  | 'open'
  | 'fulfilled'
  | 'cancelled'
  | 'expired'

export type CowSwapOrderResponse = {
  status: CowSwapOrderStatus
}

/**
 * An order as CoW Swap returns it in the list of an account's orders. Only the fields we read
 * are typed. Amounts are in the smallest unit of the token
 */
export type CowSwapAccountOrder = {
  uid: string
  status: CowSwapOrderStatus
  sellToken: string
  buyToken: string
  receiver: string | null
  sellAmount: string
  buyAmount: string
  /** For an ETH-flow order, the maximum uint32. Its real expiry is `ethflowData.userValidTo` */
  validTo: number
  /** The hash of the app data */
  appData: string
  fullAppData: string | null
  feeAmount: string
  kind: 'sell' | 'buy'
  partiallyFillable: boolean
  creationDate: string
  executedSellAmount: string
  executedBuyAmount: string
  invalidated: boolean
  /** Set only for orders created by sending the native token to the ETH-flow contract */
  ethflowData?: { userValidTo: number } | null
  /** Set for orders created onchain. `placementError` means CoW Swap refused the order */
  onchainOrderData?: { placementError?: string | null } | null
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
