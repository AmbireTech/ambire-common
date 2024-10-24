import { AccountCreation, AccountId } from './account'

export type MagicLinkFlow = 'recovery' | 'setup'

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
  requestKeySync = 'requestKeySync'
}
/**
 * Operations are used for communication between devices.
 *
 * @interface EmailVaultOperation
 * @property {string} [id] - A value that is randomly assigned by the relayer if the operation is legit.
 * @property {OperationRequestType} type - A label for the intention of the operation.
 * @property {string} requester - In the context of the EmailVault, this is the device's keystoreId, acting as a public key for encryption.
 * @property {string} key - In the context of the EmailVault and syncing keys, this is the address for the EOA we want the private key for (might not be applicable for new operation types, if any).
 * @property {string} [value] - The fetched value.
 * @property {string} [password] - The password associated with the operation. The relayer doesn't return the value of the op if wrong password
 */
export interface EmailVaultOperation {
  id?: string
  type: OperationRequestType
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
