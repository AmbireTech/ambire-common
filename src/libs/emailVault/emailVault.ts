import { relayerCall } from '../relayerCall/relayerCall'
import {
  EmailVaultData,
  EmailVaultSecret,
  RecoveryKey,
  Operation
} from '../../interfaces/emailVault'

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

  constructor(fetch: Function, relayerUrl: string) {
    this.callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
  }

  async getRecoveryKeyAddress(email: String, authKey: String): Promise<RecoveryKey> {
    return (await this.callRelayer(`/email-vault/getRecoveryKey/${email}/${authKey}`)).data
  }

  async getSessionKey(email: String, authKey: String): Promise<string> {
    return (await this.callRelayer(`/email-vault/getSessionKey/${email}/${authKey}`))?.data
      ?.sessionKey
  }

  async getEmailVaultInfo(email: String, authKey: String): Promise<EmailVaultData | null> {
    const result = (await this.callRelayer(`/email-vault/emailVaultInfo/${email}/${authKey}`)).data
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
    operations: Operation[]
  ): Promise<Operation[] | null> {
    return (
      await this.callRelayer(`/email-vault/operation/${email}/${authKey}`, 'POST', {
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
      await this.callRelayer(`/email-vault/addKeyStoreSecret/${email}/${authKey}`, 'POST', {
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
        `/email-vault/retrieveKeyStoreSecret/${email}/${keyStoreUid}/${authKey}`
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
      await this.callRelayer(`/email-vault/addKeyBackup/${email}/${authKey}`, 'POST', {
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
      await this.callRelayer(`/email-vault/retrieveKeyBackup/${email}/${keyAddress}/${authKey}`)
    ).data
  }

  async getInfo(email: String, authKey: String): Promise<EmailVaultInfo> {
    return (await this.callRelayer(`/email-vault/emailVaultInfo/${email}/${authKey}`)).data
  }
}
