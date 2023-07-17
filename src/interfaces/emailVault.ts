import { AccountCreation, AccountId } from './account'

export enum SecretType {
  RecoveryKey = 'recoveryKey',
  KeyStore = 'keyStore',
  keyBackup = 'keyBackup'
}

export interface EmailVaultSecrets {
  key: string
  value?: string
  type: SecretType
}

export interface EmailVaultAccountInfo {
  addr: AccountId
  associatedKeys: {
    [network: string]: {
      [key: string]: string
    }
  }
  creation: AccountCreation | null
}

export interface EmailVaultData {
  recoveryKey: string
  email: string
  availableAccounts: { [addr: string]: EmailVaultAccountInfo }
  availableSecrets: { [key: string]: EmailVaultSecrets }
  criticalError?: Error
  errors?: Error[]
}

export interface RecoveryKey {
  key: String
  type: String
}
