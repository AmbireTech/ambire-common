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
  if (error.toLowerCase().includes('please enable blind signing')) {
    return 'Blind Signing is disabled on your Ledger device. To sign this transaction, please enable Blind Signing (formerly called Contract Data) in the Ethereum app settings on your Ledger device, then try again.'
  }

  // Indicates a custom timeout error, no need to normalize
  if (error.includes('Could not connect to your Ledger device for an extended period')) return error

  return `Could not connect to your Ledger device. Please close any other apps that may be accessing your Ledger device (including wallet apps on your computer and web apps). Ensure your Ledger is responsive. Unplug and plug it again. Device error: ${error}`
}
