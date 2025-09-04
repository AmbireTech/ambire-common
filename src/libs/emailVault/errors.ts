type EmailVaultErrorCode =
  | 'INVALID_KEY'
  | 'NOT_FOUND'
  | 'CREATE_FAILED'
  | 'MISSING_PARAMS'
  | 'TIMEOUT'
  | 'UNKNOWN'

function classifyEmailVaultError(err: Error | undefined): EmailVaultErrorCode {
  const msg = (err?.message || '').toLowerCase()

  if (msg.includes('timeout')) return 'TIMEOUT'
  if (msg.includes('invalid key')) return 'INVALID_KEY'
  if (msg.includes('email vault not found')) return 'NOT_FOUND'
  if (msg.includes('error while creating vault')) return 'CREATE_FAILED'
  if (msg.includes('missing params')) return 'MISSING_PARAMS'

  return 'UNKNOWN'
}

function friendlyEmailVaultMessage(code: EmailVaultErrorCode, email: string): string {
  switch (code) {
    case 'INVALID_KEY':
      return `That activation link is not valid or has already been used for ${email}. Request a new link and try again.`
    case 'NOT_FOUND':
      return `We can't find an email vault for ${email}. Double-check the address or start a new setup.`
    case 'CREATE_FAILED':
      return `We couldn't create your email vault for ${email}. Please try again in a moment.`
    case 'MISSING_PARAMS':
      return 'We are missing required information to continue. Refresh and submit the form again.'
    case 'TIMEOUT':
      return `Your activation link expired for ${email}. Submit the form to get a new link.`
    default:
      return `Something went wrong while verifying ${email}. Please try again in a moment.`
  }
}

export { classifyEmailVaultError, friendlyEmailVaultMessage }
