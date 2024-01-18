import { AccountCreation, AccountId } from './account'

export enum SecretType {
  RecoveryKey = 'recoveryKey',
  KeyStore = 'keyStore',
  keyBackup = 'keyBackup'
}

export interface EmailVaultSecret {
  key: string
  value?: string
  type: SecretType
}

export interface EmailVaultAccountInfo {
  addr: AccountId
  associatedKeys: string[]
  creation: AccountCreation | null
}

export enum OperationRequestType {
  requestKeySync
}

// id - a vallue that is randomly assigned by the relayer if the operation is legit
// requestType - a label for the intention of the operation
// requester - in the context of the EmailVault this is the deveices keystoreId, that is acting as a public key for encryption
// key - in the context of the EV and syncing keys this is the address for the EOA we want th eprivate key (might not be applicable for (if any) new operation types )
// value - the fetched value
// @TODO: add OTP for key syncing requests
export interface EmailVaultOperation {
  id?: string
  type: string
  requester: string
  key: string
  value?: string
  password?: string
}

export interface EmailVaultData {
  recoveryKey: string
  email: string
  availableAccounts: { [addr: string]: EmailVaultAccountInfo }
  availableSecrets: { [key: string]: EmailVaultSecret }
  operations: EmailVaultOperation[]
}

export interface RecoveryKey {
  key: String
  type: String
}
