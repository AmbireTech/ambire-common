/** A dapp the user has not yet confirmed their password/biometrics for. */
export interface UnauthenticatedDapp {
  id: string
  name: string
}

/**
 * Why a signing request has to be confirmed with the password or biometrics before it is
 * signed. `null` in place of this means the request can be signed without a confirmation.
 */
export interface SigningAuthRequirement {
  /** Addresses this request sends funds to that the account has never sent to before. */
  firstTimeRecipients: string[]
  unauthenticatedDapps: UnauthenticatedDapp[]
}
