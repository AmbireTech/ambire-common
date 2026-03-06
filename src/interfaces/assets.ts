export interface Price {
  baseCurrency: string
  price: number
}

/**
 * Provides additional market data for a token, such as 24-hour trading volume,
 * market capitalization, and percentage change in price over the last 24 hours.
 */
export interface TokenMarketDataByCurrency {
  baseCurrency: string
  /**
   * 24-hour trading volume of the token.
   */
  volume24h?: number | null
  /**
   * Market capitalization of the token.
   */
  marketCap?: number | null
  /**
   * Percentage change in price over the last 24 hours.
   */
  change24h?: number | null
}

export type TokenMarketData = {
  marketDataIn: TokenMarketDataByCurrency[]
  /**
   * Ids of exchanges where the token is traded.
   */
  exchanges?: string[]
}
