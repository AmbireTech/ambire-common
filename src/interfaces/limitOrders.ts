import { ControllerInterface } from './controller'

export type ILimitOrdersController = ControllerInterface<
  InstanceType<typeof import('../controllers/limitOrders/limitOrders').LimitOrdersController>
>

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

/**
 * The tokens and the view a price was typed for. The price field sends a typed price after a
 * short pause, so it may arrive after the user flipped the view or changed the tokens
 */
export type LimitOrderPriceTypedFor = {
  priceView: LimitOrderPriceView
  fromTokenAddress: string
  toTokenAddress: string
}

/**
 * Today's price for the current tokens, as CoW Swap quoted it. Asked for a set amount rather than
 * the one the user enters, so the market price doesn't change with the amount
 */
export type LimitOrderMarketQuote = {
  chainId: number
  sellTokenAddress: string
  buyTokenAddress: string
  /** In the smallest unit of the sell token. The amount the price was asked for, not the order's */
  sellAmount: string
  /**
   * What selling `sellAmount` gets today, after CoW Swap's costs and the Ambire fee, in the
   * smallest unit of the receive token
   */
  buyAmount: string
  /**
   * What selling `sellAmount` gets today after CoW Swap's network cost and protocol fee, before
   * the Ambire fee, in the smallest unit of the receive token. Today's price, which the price the
   * user sets is compared to
   */
  marketBuyAmount: string
  /**
   * CoW Swap's network cost of a trade, in the smallest unit of the sell token. It's a cost per
   * trade, so it's about the same whatever the amount
   */
  networkFee: string
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
  /** Why the order can't fill while it waits, see `LimitOrderFillIssue`. Null if it can */
  fillIssue: LimitOrderFillIssue | null
  /**
   * Whether the transaction that gives back the permission the order needs was sent and isn't
   * confirmed yet. Only for an order whose `fillIssue` is `permission`
   */
  isAllowingAgain: boolean
}

/**
 * Why a waiting order can't fill, although CoW Swap still lists it as open:
 * - `permission` - CoW Swap's permission to use the token is less than the order still sells,
 *   e.g. the user removed it on another site
 * - `balance` - the account holds less of the token than the order still sells
 */
export type LimitOrderFillIssue = 'permission' | 'balance'

/**
 * What the transaction being signed does. `allow` gives CoW Swap back the permission the open
 * orders of a token need
 */
export type LimitOrderSignPurpose = 'place' | 'cancel' | 'allow'
