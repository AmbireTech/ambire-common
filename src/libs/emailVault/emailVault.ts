// @NOTE<Yosif> Should keyAddress, keyStoreUid and recoveryKey be of type Address and not String?

import { relayerCall } from '../relayerCall/relayerCall'

export interface EmailVaultFetchResult {
  success: Boolean
  data: VaultEntry
  message: String
}

// @NOTE<Yosif> Should key be of type Address and not String?
export interface VaultEntry {
  key: String
  value: String
  type: String
}

export interface Secret {
  key: String
  type: String
}

export interface EmailVaultInfo {
  _id: String
  secrets: Secret[]
  version: number
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

  async create(email: String, authKey: String): Promise<VaultEntry> {
    return (await this.callRelayer(`/email-vault/create/${email}/${authKey}`)).data
  }

  async getRecoveryKeyAddress(email: String, authKey: String): Promise<VaultEntry> {
    return (await this.callRelayer(`/email-vault/getRecoveryKey/${email}/${authKey}`)).data
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
  ): Promise<VaultEntry> {
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

  async retrieveKeyBackup(email: String, authKey: String, keyAddress: String): Promise<VaultEntry> {
    return (
      await this.callRelayer(`/email-vault/retrieveKeyBackup/${email}/${keyAddress}/${authKey}`)
    ).data
  }

  async getInfo(email: String, authKey: String): Promise<EmailVaultInfo> {
    return (await this.callRelayer(`/email-vault/emailVaultInfo/${email}/${authKey}`)).data
  }
}
