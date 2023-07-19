import { relayerCall } from '../relayerCall/relayerCall'
import { EmailVaultData, EmailVaultSecrets, RecoveryKey } from '../../interfaces/emailVault'

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

  private fetch: Function

  private relayerUrl: string

  constructor(fetch: Function, relayerUrl: string) {
    this.callRelayer = relayerCall.bind({ url: relayerUrl })
    this.relayerUrl = relayerUrl
    this.fetch = fetch
  }

  async create(email: String, authKey: String): Promise<EmailVaultSecrets> {
    return (await this.callRelayer(`/email-vault/create/${email}/${authKey}`)).data
  }

  async getRecoveryKeyAddress(email: String, authKey: String): Promise<RecoveryKey> {
    return (await this.callRelayer(`/email-vault/getRecoveryKey/${email}/${authKey}`)).data
  }

  async getEmailVaultInfo(email: String, authKey: String): Promise<EmailVaultData> {
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
  ): Promise<EmailVaultSecrets> {
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
  ): Promise<EmailVaultSecrets> {
    return (
      await this.callRelayer(`/email-vault/retrieveKeyBackup/${email}/${keyAddress}/${authKey}`)
    ).data
  }

  async getInfo(email: String, authKey: String): Promise<EmailVaultInfo> {
    return (await this.callRelayer(`/email-vault/emailVaultInfo/${email}/${authKey}`)).data
  }
}
