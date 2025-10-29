import { AccountIdentityResponse } from '../../interfaces/account'

/**
 * Parses an identity response from the Ambire Relayer API and extracts identity data.
 * Returns normalized identity information with defaults for missing fields.
 */
export function normalizeIdentityResponse(addr: string, response?: AccountIdentityResponse | null) {
  const initialPrivileges = response?.initialPrivileges || []
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
    initialPrivileges
  }
}
