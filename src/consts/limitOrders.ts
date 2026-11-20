import { LimitOrderPrice } from '../interfaces/limitOrders'

/** The price a new limit order form starts with: 1% better than today's */
export const DEFAULT_LIMIT_ORDER_PRICE: LimitOrderPrice = { mode: 'relative', bps: 100 }

/** How much better than today's price the limit order slider goes, in basis points */
export const LIMIT_ORDER_MAX_RELATIVE_BPS = 3000
