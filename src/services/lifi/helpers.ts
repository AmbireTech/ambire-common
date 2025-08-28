import { HUMANIZED_ERRORS } from './consts'

/**
 * Calculates dynamic slippage based on transaction amount with absolute loss protection.
 * This prevents large absolute losses while maintaining transaction success rates. Logic:
 * 1. Baseline percentage: 1% for < $400, decreasing for larger amounts
 * 2. Absolute loss cap: maxUsdLoss / amount (e.g., $100 / $70,000 = 0.143%)
 * 3. Final slippage: min(baseline, cap), but never below minPercentage
 *
 * Examples:
 * - "100" → 1.0% (0.010) - baseline prevails
 * - "10000" → 0.5% (0.005) - baseline prevails
 * - "70000" → 0.143% (0.001) - absolute loss cap prevails (prevents $350 loss)
 * - "100000" → 0.1% (0.001) - absolute loss cap prevails (prevents $100 loss)
 */
export const calculateDynamicSlippage = (
  amountInUsd: string, // transaction amount in USD, as a string
  maxUsdLoss: number = 100, // maximum allowed USD loss
  minPercentage: number = 0.001, // minimum slippage percentage
  smallAmountPercentage: number = 0.01 // slippage for small amounts < $400
): string => {
  const amount = Number(amountInUsd)

  // Handle invalid inputs by returning default slippage
  if (Number.isNaN(amount) || !Number.isFinite(amount) || amount < 0)
    return smallAmountPercentage.toFixed(3)

  // 1) Baseline percentage
  let basePct: number
  if (amount < 400) {
    basePct = smallAmountPercentage
  } else {
    const factor = Math.ceil(amount / 20000)
    const calculatedSlippage = 0.005 / factor
    basePct = Math.max(minPercentage, calculatedSlippage)
  }

  // 2) Absolute loss cap in percentage of the amount
  const capPct = amount > 0 ? maxUsdLoss / amount : basePct

  // 3) Final slippage = min(baseline, cap), but never below minPercentage
  const finalPct = Math.max(minPercentage, Math.min(basePct, capPct))

  return finalPct.toFixed(3)
}

export const getHumanReadableErrorMessage = (
  errorPrefix: string,
  error?: unknown
): string | null => {
  // The code should be safe but we must ensure that humanizing errors
  // does not throw an error itself
  try {
    if (!error || typeof error !== 'object' || !('message' in error)) {
      return null
    }

    const checkAgainst = error?.message

    let message = null

    if (checkAgainst && typeof checkAgainst === 'string') {
      HUMANIZED_ERRORS.forEach((humanizedError) => {
        const { isExactMatch } = humanizedError

        const isMatching = humanizedError.reasons.some((errorReason) => {
          const lowerCaseReason = errorReason.toLowerCase()
          const lowerCaseCheckAgainst = checkAgainst.toLowerCase()

          if (isExactMatch) {
            // Try a simple equality check first
            if (lowerCaseCheckAgainst === lowerCaseReason) return true

            // Split checkAgainst by spaces and check if any of the parts
            // match the lowerCaseReason
            const splitCheckAgainst = checkAgainst.split(' ')

            return splitCheckAgainst.some((part) => part.toLowerCase() === lowerCaseReason)
          }

          return lowerCaseCheckAgainst.includes(lowerCaseReason)
        })
        if (!isMatching) return

        message = humanizedError.message
      })
    }

    return message
  } catch (e) {
    console.error('Error while getting human readable error message in lifi.ts:', e)

    return null
  }
}
