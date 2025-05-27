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
    return 'Cannot connect to your Ledger device. Please make sure it is connected.'

  if (error.includes('unlock-device')) return 'Please unlock your Ledger device first.'

  if (error.includes('confirm-open-app'))
    return 'Please open the Ethereum app on your Ledger device first.'

  if (
    error.includes('5515') ||
    error.includes('6b0c') ||
    error.includes('650f') ||
    error.includes('6511')
  ) {
    return 'Cannot connect to your Ledger device. Please make sure it is unlocked and running the Ethereum app.'
  }
  if (error.includes('6e00') || error.includes('6b00')) {
    return 'Your Ledger device requires a firmware and Ethereum App update.'
  }
  if (error.includes('6d00')) {
    return "Your Ledger doesn't recognize the command sent. Please update device firmware and Ethereum App and try again."
  }
  if (error.includes('6985') || error.includes('5501')) {
    return 'Rejected by your Ledger device.'
  }
  if (error.toLowerCase().includes('please enable blind signing') || error.includes('6a80')) {
    return 'Blind Signing is disabled on your Ledger device. To sign this transaction, please enable Blind Signing (formerly called Contract Data) in the Ethereum app settings on your Ledger device, then try again.'
  }

  // Indicates a custom timeout error, no need to normalize
  if (error.includes('Cannot connect to your Ledger device for an extended period')) return error

  if (error.includes('The device is already open'))
    return 'Ledger device busy. Please make sure there are no pending requests on the device.'

  console.error('Unknown Ledger error:', error)

  return `Cannot connect to your Ledger device. Close all other apps that may be accessing it (including apps on your computer). Ensure device is responsive. Ensure Ledger firmware and Ethereum App are up to date. Device error: ${error}`
}
