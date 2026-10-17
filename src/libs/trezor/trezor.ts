/**
 * Used to "translate" error codes returned by the Trezor device into a
 * human-readable messages. Although there is a message incoming from Trezor,
 * it's not self-explanatory and can be difficult for the end users to understand.
 */
export const getMessageFromTrezorErrorCode = (
  errorCode?: string,
  errorMsg?: string,
  context?: {
    isLedgerLiveSmartAccountForbiddenPath?: boolean
    isHyperEvmForbiddenPath?: boolean
  }
): string => {
  if (!errorCode && !errorMsg) return 'Could not connect to your Trezor device. Please try again.'

  if (context?.isHyperEvmForbiddenPath && errorMsg?.toLowerCase()?.includes('forbidden key path')) {
    return 'Please set "Safety checks" to "Prompt" in Trezor Suite (Settings - Device) to use your Trezor on HyperEVM chain. This is flagged as non-standard and blocked otherwise.'
  }

  if (
    context?.isLedgerLiveSmartAccountForbiddenPath &&
    errorMsg?.toLowerCase()?.includes('forbidden key path')
  ) {
    return 'Please set "Safety checks" to "Prompt" in Trezor Suite (Settings - Device) to use your Trezor (with Ledger Live HD paths) as a key for your Ambire smart account. This is flagged as non-standard and blocked otherwise.'
  }

  // The EIP-7702 authorization is an experimental firmware field, refused unless
  // the "experimental features" device setting is on (not toggleable in Trezor Suite yet)
  if (errorMsg?.toLowerCase()?.includes('experimental features are disabled'))
    return 'To upgrade your account with Trezor, first turn on "experimental features" on your Trezor device. This option is not available in Trezor Suite yet.'

  // The firmware allows upgrading only to the account types it knows, per network
  if (errorMsg?.toLowerCase()?.includes('unknown eip-7702 delegate address'))
    return 'Your Trezor does not support the Ambire account upgrade on this network yet.'

  if (errorCode === 'Method_Interrupted')
    return 'Closing the Trezor popup interrupted the connection.'

  if (errorCode === 'Method_Cancel') return 'Permission not granted.'

  if (errorCode === 'Failure_ActionCancelled') return 'Rejected by your Trezor device.'

  if (
    errorMsg?.toLowerCase()?.includes('device disconnected during action') ||
    errorCode === 'Device_Disconnected'
  )
    return 'Trezor device got disconnected.'

  if (errorCode === 'Device_CallInProgress')
    return 'Trezor device busy. Please make sure there are no pending requests on the device.'

  return `${errorMsg} (${errorCode ?? 'no error code incoming'})`
}

/**
 * Used to "translate" errors thrown by the Trezor device into a human-readable
 * messages. Some of them are not self-explanatory and can be difficult for the
 * end users to understand.
 */
export const normalizeTrezorMessage = (error?: string): string => {
  if (!error || error?.includes('handshake failed')) {
    return 'Could not connect to your Trezor device. Please try again.'
  }

  return error
}

// Temporarily, until Trezor makes their error types consistent
export const getTrezorErrorMessageFromPayload = (trezorUnsuccessfulPayload: any): string => {
  // Trezor SDK TS promises "error", but Trezor Suite the message comes as "message"
  return trezorUnsuccessfulPayload?.error || trezorUnsuccessfulPayload?.message
}
