import { AccountIdentityResponse } from '../../interfaces/account'

/**
 * Parses an identity response from the Ambire Relayer API and extracts identity data.
 * Returns normalized identity information with defaults for missing fields.
 */
export function normalizeIdentityResponse(addr: string, response?: AccountIdentityResponse | null) {
  const creation =
    typeof response?.identityFactoryAddr === 'string' &&
    typeof response?.bytecode === 'string' &&
    typeof response?.salt === 'string'
      ? {
          factoryAddr: response.identityFactoryAddr,
          bytecode: response.bytecode,
          salt: response.salt
        }
      : null
  const associatedKeys = response?.associatedKeys
    ? Object.keys(response?.associatedKeys || {})
    : [addr]

  return {
    creation,
    associatedKeys,
    // Applies only to Ambire smart accounts (not coming in the AccountIdentityResponse).
    // - view-only accounts: can be empty.
    // - ambire smart v2: generated from `associatedKeys`, key management was never
    // implemented for these, so privileges are technically static in this case
    // - ambire smart v1: `initialPrivileges` would be set upon re-importing
    // account with key as a linked account
    initialPrivileges: []
  }
}
