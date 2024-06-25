import {
  EmailVaultData,
  EmailVaultOperation,
  EmailVaultSecret,
  RecoveryKey
} from '../../interfaces/emailVault'
import { Fetch } from '../../interfaces/fetch'
import { relayerCall } from '../relayerCall/relayerCall'

export interface Secret {
  key: String
  type: String
}

// NOTE: its a quick fix. Will be updated in other branch
export interface EmailVaultInfo {
  email: String
  recoveryKey: String
  availableSecrets: Secret[]
  availableAccounts: any
}

export class EmailVault {
  private callRelayer: Function

  constructor(fetch: Fetch, relayerUrl: string) {
    this.callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
  }

  async getRecoveryKeyAddress(email: String, authKey: String): Promise<RecoveryKey> {
    return (await this.callRelayer(`/email-vault/get-recovery-key/${email}/${authKey}`)).data
  }

  async getSessionKey(email: String, authKey: String): Promise<string> {
    return (await this.callRelayer(`/email-vault/get-session-key/${email}/${authKey}`))?.data
      ?.sessionKey
  }

  async getEmailVaultInfo(email: String, authKey: String): Promise<EmailVaultData | null> {
    const result = await this.callRelayer(`/email-vault/email-vault-info/${email}/${authKey}`).then(
      (res: any) => res.data
    )

    return {
      ...result,
      availableAccounts: Object.fromEntries(
        result.availableAccounts.map((acc: any) => [acc.addr, acc])
      ),
      availableSecrets: Object.fromEntries(
        result.availableSecrets.map((secret: any) => [secret.key, secret])
      )
    }
  }

  async operations(
    email: String,
    authKey: String,
    operations: EmailVaultOperation[]
  ): Promise<EmailVaultOperation[] | null> {
    return (
      await this.callRelayer(`/email-vault/post-operations/${email}/${authKey}`, 'POST', {
        operations
      })
    ).data
  }

  async getOperations(
    email: String,
    authKey: String,
    operations: EmailVaultOperation[]
  ): Promise<EmailVaultOperation[] | null> {
    return (
      await this.callRelayer(`/email-vault/get-operations/${email}/${authKey}`, 'POST', {
        operations
      })
    ).data
  }

  async addKeyStoreSecret(
    email: String,
    authKey: String,
    keyStoreUid: String,
    secret: String
  ): Promise<Boolean> {
    return (
      await this.callRelayer(`/email-vault/add-key-store-secret/${email}/${authKey}`, 'POST', {
        secret,
        uid: keyStoreUid
      })
    ).success
  }

  async retrieveKeyStoreSecret(
    email: String,
    authKey: String,
    keyStoreUid: String
  ): Promise<EmailVaultSecret> {
    return (
      await this.callRelayer(
        `/email-vault/retrieve-key-store-secret/${email}/${keyStoreUid}/${authKey}`
      )
    ).data
  }

  async addKeyBackup(
    email: String,
    authKey: String,
    keyAddress: String,
    privateKeyEncryptedJSON: String
  ): Promise<Boolean> {
    return (
      await this.callRelayer(`/email-vault/add-key-backup/${email}/${authKey}`, 'POST', {
        keyAddress,
        encryptedBackup: privateKeyEncryptedJSON
      })
    ).success
  }

  async retrieveKeyBackup(
    email: String,
    authKey: String,
    keyAddress: String
  ): Promise<EmailVaultSecret> {
    return (
      await this.callRelayer(`/email-vault/retrieve-key-backup/${email}/${keyAddress}/${authKey}`)
    ).data
  }

  async getInfo(email: String, authKey: String): Promise<EmailVaultInfo> {
    return (await this.callRelayer(`/email-vault/email-vault-info/${email}/${authKey}`)).data
  }
}
