import { fetchCaught } from '../../../v1/services/fetch'
import { Fetch } from '../../interfaces/fetch'

export async function getIdentity(address: string, fetch: Fetch, relayerUrl: string) {
  // Use `fetchCaught` because the endpoint could return 404 if the account
  // is not found, which should not throw an error
  const accountIdentityResponse = await fetchCaught(fetch, `${relayerUrl}/v2/identity/${address}`)

  // Trick to determine if there is an error throw. When the request 404s,
  // there is no error message incoming, which is enough to treat it as a
  // no-error, 404 response is expected for EOAs.
  if (accountIdentityResponse?.errMsg) throw new Error(accountIdentityResponse.errMsg)

  const accountIdentity: any = accountIdentityResponse?.body
  let creation = null
  let associatedKeys = [address]
  if (
    typeof accountIdentity === 'object' &&
    accountIdentity !== null &&
    'identityFactoryAddr' in accountIdentity &&
    typeof accountIdentity.identityFactoryAddr === 'string' &&
    'bytecode' in accountIdentity &&
    typeof accountIdentity.bytecode === 'string' &&
    'salt' in accountIdentity &&
    typeof accountIdentity.salt === 'string'
  ) {
    creation = {
      factoryAddr: accountIdentity.identityFactoryAddr,
      bytecode: accountIdentity.bytecode,
      salt: accountIdentity.salt
    }
  }

  if (accountIdentity?.associatedKeys) {
    associatedKeys = Object.keys(accountIdentity?.associatedKeys || {})
  }

  const initialPrivileges = accountIdentity?.initialPrivileges || []

  return {
    creation,
    associatedKeys,
    initialPrivileges
  }
}
