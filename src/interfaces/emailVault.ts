import { AccountCreation, AccountId } from './account'

enum SecretType {
  recoveryKey,
  keyStore,
  keyBackup
}

export interface EmailVaultSecrets {
  key: String
  value?: String
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
  recoveryKey: String
  email: string
  availableAccounts: EmailVaultAccountInfo[]
  availableSecrets: EmailVaultSecrets[]
}
