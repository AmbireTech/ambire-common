export function getIdentity(address: string, accountIdentityRes?: any) {
  let creation = null
  let associatedKeys = [address]
  if (
    typeof accountIdentityRes === 'object' &&
    accountIdentityRes !== null &&
    'identityFactoryAddr' in accountIdentityRes &&
    typeof accountIdentityRes.identityFactoryAddr === 'string' &&
    'bytecode' in accountIdentityRes &&
    typeof accountIdentityRes.bytecode === 'string' &&
    'salt' in accountIdentityRes &&
    typeof accountIdentityRes.salt === 'string'
  ) {
    creation = {
      factoryAddr: accountIdentityRes.identityFactoryAddr,
      bytecode: accountIdentityRes.bytecode,
      salt: accountIdentityRes.salt
    }
  }

  if (accountIdentityRes?.associatedKeys) {
    associatedKeys = Object.keys(accountIdentityRes?.associatedKeys || {})
  }

  const initialPrivileges = accountIdentityRes?.initialPrivileges || []

  return {
    creation,
    associatedKeys,
    initialPrivileges
  }
}
