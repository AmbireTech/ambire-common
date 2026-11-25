import { LimitOrderPrice } from '../interfaces/limitOrders'

/** How much better than today's price a new price starts, in basis points: 1% */
export const DEFAULT_LIMIT_ORDER_PRICE_BPS = 100

/** The price a new limit order form starts with: 1% better than today's */
export const DEFAULT_LIMIT_ORDER_PRICE: LimitOrderPrice = {
  mode: 'relative',
  bps: DEFAULT_LIMIT_ORDER_PRICE_BPS
}

/** How much better than today's price the limit order slider goes, in basis points */
export const LIMIT_ORDER_MAX_RELATIVE_BPS = 3000

/** How many days a new limit order stays open, unless the user changes it */
export const DEFAULT_LIMIT_ORDER_EXPIRY_DAYS = 30

/** The most days a limit order can stay open. CoW Swap accepts limit orders valid for up to a year */
export const LIMIT_ORDER_MAX_EXPIRY_DAYS = 180
