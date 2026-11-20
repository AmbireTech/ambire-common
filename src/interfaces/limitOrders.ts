import { COWSWAP_LIMIT_ORDER_EXPIRY_SECONDS } from '../services/cowswap/constants'
import { ControllerInterface } from './controller'

export type ILimitOrdersController = ControllerInterface<
  InstanceType<typeof import('../controllers/limitOrders/limitOrders').LimitOrdersController>
>

/** How long a limit order stays open, one of the options the user picks from */
export type LimitOrderExpiry = keyof typeof COWSWAP_LIMIT_ORDER_EXPIRY_SECONDS

/**
 * Which way the price is shown and typed:
 * - `cost` - how much of the sell token 1 receive token costs ("1 WETH costs 1,658.73 USDC").
 *   A lower price is better
 * - `get` - how much of the receive token 1 sell token gets ("1 WBTC gets you 56.09 WETH").
 *   A higher amount is better
 */
export type LimitOrderPriceView = 'cost' | 'get'

/**
 * The price the user set, read in the current `LimitOrderPriceView`:
 * - `relative` - better than today's price by `bps` (500 is 5%). It follows today's price
 * - `absolute` - a typed price, in human units of the token the view prices in
 */
export type LimitOrderPrice =
  | { mode: 'relative'; bps: number }
  | { mode: 'absolute'; amount: string }

/** Today's price for the current form, as CoW Swap quoted it */
export type LimitOrderMarketQuote = {
  chainId: number
  sellTokenAddress: string
  buyTokenAddress: string
  /** In the smallest unit of the sell token */
  sellAmount: string
  /**
   * What selling `sellAmount` gets today, after CoW Swap's costs and the Ambire fee, in the
   * smallest unit of the receive token
   */
  buyAmount: string
  /**
   * What `sellAmount` is worth at today's market price, before any fee, in the smallest unit of
   * the receive token. The price the user sets is compared to this one
   */
  buyAmountBeforeFees: string
  /** CoW Swap's network cost of filling the order, in the smallest unit of the sell token */
  networkFee: string
  /** CoW Swap's own fee, as a share of the amount before fees */
  protocolFeeBps: number
  quoteId: number | null
  fetchedAt: number
}

/**
 * - `worse-than-today` - the price is worse than today's market price
 * - `invalid` - the typed price can't be read
 * - `too-small` - the network cost and the fees would take all the order gets
 */
export type LimitOrderPriceError = 'worse-than-today' | 'invalid' | 'too-small'

export type LimitOrderFormStatus =
  | 'EMPTY'
  | 'INVALID'
  | 'LOADING_PRICE'
  | 'PRICE_UNAVAILABLE'
  | 'READY'
  | 'PLACING'
  | 'PROCEEDED'

export type LimitOrderStatus =
  /** Sent to CoW Swap; its transaction was broadcast and isn't confirmed yet */
  | 'placing'
  | 'open'
  | 'partiallyFilled'
  | 'filled'
  /** A transaction that cancels it was broadcast and isn't confirmed yet */
  | 'cancelling'
  | 'cancelled'
  | 'expired'
  /** CoW Swap refused an order created onchain. Cancelling it returns the native token */
  | 'rejected'

export type LimitOrderToken = {
  chainId: number
  address: string
  symbol: string
  decimals: number
  icon?: string
}

/** An Ambire limit order of the selected account, as shown in My orders */
export type LimitOrder = {
  uid: string
  chainId: number
  status: LimitOrderStatus
  sellToken: LimitOrderToken
  buyToken: LimitOrderToken
  /** Amounts in the smallest unit of their token */
  sellAmount: string
  buyAmount: string
  executedSellAmount: string
  executedBuyAmount: string
  /** Unix seconds */
  validTo: number
  /** Unix milliseconds */
  createdAt: number
  isEthFlow: boolean
  partiallyFillable: boolean
  /** The Ambire fee the order carries, in basis points */
  feeBps: number
}

/** What the transaction being signed does */
export type LimitOrderSignPurpose = 'place' | 'cancel'
