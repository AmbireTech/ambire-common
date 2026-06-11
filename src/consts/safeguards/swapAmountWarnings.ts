import { SwapAmountWarningSeverity } from './extremeSwapLoss'

export type HighPriceImpactWarning = {
  type: 'highPriceImpact'
  percentageDiff: number
  estimatedLossUsd: number
  severity: SwapAmountWarningSeverity
}

export type SlippageImpactWarning = {
  type: 'slippageImpact'
  possibleSlippage: number
  minInUsd: number
  minInToken: string
  symbol: string
  estimatedLossUsd: number
  severity: SwapAmountWarningSeverity
}

export type SwapAmountWarning = HighPriceImpactWarning | SlippageImpactWarning
