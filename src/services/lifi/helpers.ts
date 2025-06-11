import { HUMANIZED_ERRORS } from './consts'

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
