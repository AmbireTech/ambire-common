import { AssetType } from '../defiPositions/types'
import { getTokenBalanceInUSD } from './helpers'
import { TokenResult } from './interfaces'

export const LOW_VALUE_TOKEN_PRICE_THRESHOLD_USD = 0.01
export const LOW_VALUE_COLLAPSE_MIN_TOKEN_COUNT = 100

export const getTokenUnitPriceUSD = (token: TokenResult): number | null => {
  const usdPriceEntry = token.priceIn.find(
    ({ baseCurrency }) => baseCurrency.toLowerCase() === 'usd'
  )

  if (!usdPriceEntry) return null

  return usdPriceEntry.price
}

export const isLowValueToken = (token: TokenResult): boolean => {
  const unitPrice = getTokenUnitPriceUSD(token)

  // No USD price — nothing meaningful to show per row.
  if (unitPrice === null) return true

  // Collapse by position value, not unit price. A $0.005 token with a large
  // balance can still be a meaningful holding and must stay visible.
  // Matches the "<$0.01" display rule used in formatDecimals for portfolio balances.
  return getTokenBalanceInUSD(token) < LOW_VALUE_TOKEN_PRICE_THRESHOLD_USD
}

export const shouldCollapseLowValueTokens = (tokenCount: number): boolean =>
  tokenCount >= LOW_VALUE_COLLAPSE_MIN_TOKEN_COUNT

export const shouldExcludeFromLowValueCollapse = (token: TokenResult): boolean => {
  if (
    typeof token.amountPostSimulation === 'bigint' &&
    token.amountPostSimulation !== BigInt(token.amount)
  ) {
    return true
  }

  if (token.flags.rewardsType) return true

  return false
}

export const getDashboardTokenCount = (tokens: TokenResult[]): number =>
  tokens.filter((token) => !token.flags.onGasTank && token.flags.defiTokenType !== AssetType.Borrow)
    .length

export const partitionLowValueTokens = (tokens: TokenResult[]) => {
  const visible: TokenResult[] = []
  const lowValue: TokenResult[] = []

  tokens.forEach((token) => {
    if (isLowValueToken(token)) {
      lowValue.push(token)
    } else {
      visible.push(token)
    }
  })

  const lowValueTotalUsd = lowValue.reduce((total, token) => total + getTokenBalanceInUSD(token), 0)

  return { visible, lowValue, lowValueTotalUsd }
}
