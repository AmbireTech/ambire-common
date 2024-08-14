/**
 * Used to "translate" error codes (inside the messages) returned by the Ledger
 * device into a human-readable messages. Although alongside the raw error codes
 * there is a message incoming from Ledger too, it's not self-explanatory and
 * can be difficult for the end users to understand.
 */
export const normalizeLedgerMessage = (error?: string): string => {
  if (
    !error ||
    // Generic error returned by the Ledger transport (@ledgerhq/hw-transport)
    error.toLowerCase().includes('access denied')
  )
    return 'Could not connect to your Ledger device. Please make sure it is connected.'

  if (
    error.includes('0x5515') ||
    error.includes('0x6b0c') ||
    error.includes('0x650f') ||
    error.includes('0x6511')
  ) {
    return 'Could not connect to your Ledger device. Please make sure it is unlocked and running the Ethereum app.'
  }
  if (error.includes('0x6e00') || error.includes('0x6b00')) {
    return 'Your Ledger device requires a firmware and Ethereum App update.'
  }
  if (error.includes('0x6985')) {
    return 'Rejected by your Ledger device.'
  }

  return `Could not connect to your Ledger device. Please close any other apps that may be accessing your Ledger device (including wallet apps on your computer and web apps). Ensure your Ledger device is connected and responsive. Device error: ${error}`
}

/**
 * Handles the scenario where Ledger device hangs indefinitely during an
 * operation. Happens in some cases when the Ledger device gets connected to
 * Ambire, then another app is accessing the Ledger device and then user comes
 * back to Ambire (without unplug-plugging the Ledger).
 */
const TIMEOUT_FOR_LEDGER_OPERATION = 5000
export const withLedgerTimeoutProtection = async <T>(operation: () => Promise<T>): Promise<T> => {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      const message =
        'Could not connect to your Ledger device for an extended period. Please close any other apps that may be accessing your Ledger device (including wallet apps on your computer and web apps). Ensure your Ledger device is connected and responsive.'
      reject(new Error(message))
    }, TIMEOUT_FOR_LEDGER_OPERATION)
  })

  return Promise.race([operation(), timeout])
}
