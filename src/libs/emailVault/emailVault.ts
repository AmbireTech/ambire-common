import {
  EmailVaultData,
  EmailVaultOperation,
  EmailVaultSecret,
  RecoveryKey
} from '../../interfaces/emailVault'
import { Fetch } from '../../interfaces/fetch'
import { relayerCall } from '../relayerCall/relayerCall'

export interface Secret {
  key: string
  type: string
}

// NOTE: its a quick fix. Will be updated in other branch
export interface EmailVaultInfo {
  email: string
  recoveryKey: string
  availableSecrets: Secret[]
  availableAccounts: any
}

export class EmailVault {
  private callRelayer: Function

  constructor(fetch: Fetch, relayerUrl: string) {
    this.callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
  }

  async getRecoveryKeyAddress(email: string, authKey: string): Promise<RecoveryKey> {
    return (await this.callRelayer(`/email-vault/get-recovery-key/${email}/${authKey}`)).data
  }

  async getSessionKey(email: string, authKey: string): Promise<string> {
    return (await this.callRelayer(`/email-vault/get-session-key/${email}/${authKey}`))?.data
      ?.sessionKey
  }

  async getEmailVaultInfo(email: string, authKey: string): Promise<EmailVaultData | null> {
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
    email: string,
    authKey: string,
    operations: EmailVaultOperation[]
  ): Promise<EmailVaultOperation[] | null> {
    return (
      await this.callRelayer(`/email-vault/post-operations/${email}/${authKey}`, 'POST', {
        operations
      })
    ).data
  }

  async getOperations(
    email: string,
    authKey: string,
    operations: EmailVaultOperation[]
  ): Promise<EmailVaultOperation[] | null> {
    return (
      await this.callRelayer(`/email-vault/get-operations/${email}/${authKey}`, 'POST', {
        operations
      })
    ).data
  }

  async addKeyStoreSecret(
    email: string,
    authKey: string,
    keyStoreUid: string,
    secret: string
  ): Promise<boolean> {
    return (
      await this.callRelayer(`/email-vault/add-key-store-secret/${email}/${authKey}`, 'POST', {
        secret,
        uid: keyStoreUid
      })
    ).success
  }

  async removeKeyStoreSecretFromRelayer(
    email: string,
    authKey: string,
    keyStoreUid: string
  ): Promise<boolean> {
    return (
      await this.callRelayer(`/email-vault/remove-key-store-secret/${email}/${authKey}`, 'POST', {
        uid: keyStoreUid
      })
    ).success
  }

  async retrieveKeyStoreSecret(
    email: string,
    authKey: string,
    keyStoreUid: string
  ): Promise<EmailVaultSecret> {
    return (
      await this.callRelayer(
        `/email-vault/retrieve-key-store-secret/${email}/${keyStoreUid}/${authKey}`
      )
    ).data
  }

  async addKeyBackup(
    email: string,
    authKey: string,
    keyAddress: string,
    privateKeyEncryptedJSON: string
  ): Promise<boolean> {
    return (
      await this.callRelayer(`/email-vault/add-key-backup/${email}/${authKey}`, 'POST', {
        keyAddress,
        encryptedBackup: privateKeyEncryptedJSON
      })
    ).success
  }

  async retrieveKeyBackup(
    email: string,
    authKey: string,
    keyAddress: string
  ): Promise<EmailVaultSecret> {
    return (
      await this.callRelayer(`/email-vault/retrieve-key-backup/${email}/${keyAddress}/${authKey}`)
    ).data
  }

  async getInfo(email: string, authKey: string): Promise<EmailVaultInfo> {
    return (await this.callRelayer(`/email-vault/email-vault-info/${email}/${authKey}`)).data
  }
}
