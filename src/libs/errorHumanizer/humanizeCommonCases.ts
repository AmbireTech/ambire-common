import { BROADCAST_OR_ESTIMATION_ERRORS } from './errors'

const humanizeEstimationOrBroadcastError = (
  reason: string | null,
  prefix: string,
  originalError: any
): string | null => {
  let message = null

  const checkAgainst = reason || originalError?.error?.message || originalError?.message

  if (checkAgainst) {
    BROADCAST_OR_ESTIMATION_ERRORS.forEach((error) => {
      const isMatching = error.reasons.some((errorReason) =>
        checkAgainst.toLowerCase().includes(errorReason.toLowerCase())
      )
      if (!isMatching) return

      message = `${prefix !== '' ? `${prefix} ` : ''}${error.message}`
    })
  }

  return message
}

export { humanizeEstimationOrBroadcastError }
