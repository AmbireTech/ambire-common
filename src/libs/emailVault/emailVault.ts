import { Address } from 'ethereumjs-util'

export interface EmailVaultFetchResult {
  success: Boolean
  data: VaultEntry
  message: String
}

export interface VaultEntry {
  key: String
  value: String
  type: String
}

export class EmailVault {
  private fetch: Function

  private relayerUrl: String

  constructor(fetch: Function, relayerUrl: String) {
    this.fetch = fetch
    this.relayerUrl = relayerUrl
  }

  async create(email: String, authKey: String): Promise<VaultEntry> {
    const resp = await this.fetch(`${this.relayerUrl}/email-vault/create/${email}/${authKey}`)
    const result: EmailVaultFetchResult = await resp.json()

    if (!result.success)
      throw new Error(`emailvault: create email vault faild with: ${result.message}`)

    return result.data
  }

  async getRecoveryKeyAddress(email: String, authKey: String): Promise<VaultEntry> {
    const resp = await this.fetch(
      `${this.relayerUrl}/email-vault/getRecoveryKey/${email}/${authKey}`
    )
    const result: EmailVaultFetchResult = await resp.json()
    if (!result.success)
      throw new Error(`emailvault: getting recovery key address: ${result.message}`)

    return result.data
  }

  async addKeyStoreSecret(
    email: String,
    authKey: String,
    keyStoreUid: String,
    secret: String
  ): Promise<Boolean> {
    const resp = await this.fetch(
      `${this.relayerUrl}/email-vault/addKeyStoreSecret/${email}/${authKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          secret,
          uid: keyStoreUid
        })
      }
    )
    const result: EmailVaultFetchResult = await resp.json()
    if (!result.success)
      throw new Error(`emailvault: error adding key store secret: ${result.message}`)

    return true
  }

  async retrieveKeyStoreSecret(
    email: String,
    authKey: String,
    keyStoreUid: String
  ): Promise<VaultEntry> {
    const resp = await this.fetch(
      `${this.relayerUrl}/email-vault/retrieveKeyStoreSecret/${email}/${keyStoreUid}/${authKey}`
    )
    const result: EmailVaultFetchResult = await resp.json()
    if (!result.success)
      throw new Error(`emailvault: getting recovery key address: ${result.message}`)

    return result.data
  }

  async addKeyBackup(
    email: String,
    authKey: String,
    keyAddress: String,
    privateKeyEncryptedJSON: String
  ): Promise<Boolean> {
    const resp = await this.fetch(
      `${this.relayerUrl}/email-vault/addKeyBackup/${email}/${authKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          keyAddress,
          encryptedBackup: privateKeyEncryptedJSON
        })
      }
    )
    const result: EmailVaultFetchResult = await resp.json()
    if (!result.success) throw new Error(`emailvault: error adding key backup: ${result.message}`)

    return true
  }

  async retrieveKeyBackup(email: String, authKey: String, keyAddress: String): Promise<VaultEntry> {
    const resp = await this.fetch(
      `${this.relayerUrl}/email-vault/retrieveKeyBackup/${email}/${keyAddress}/${authKey}`
    )
    const result: EmailVaultFetchResult = await resp.json()
    if (!result.success) throw new Error(`emailvault: getting key backup: ${result.message}`)

    return result.data
  }
}
