import crypto from 'crypto'

import { EmailVaultData, EmailVaultSecrets, SecretType } from '../interfaces/emailVault'
import { Storage } from '../interfaces/storage'
import { EmailVault } from '../libs/emailVault/emailVault'
import { requestMagicLink } from '../libs/magicLink/magicLink'
import EventEmitter from './eventEmitter'
import { KeystoreController } from './keystore/keystore'

export enum EmailVaultState {
  Loading,
  WaitingEmailConfirmation,
  Ready
}

export type MagicLinkKey = {
  key: string
  requestedAt: Date
  confirmed: boolean
}

const RECOVERY_SECRET_ID = 'EmailVaultRecoverySecret'
const EMAIL_VAULT_STORAGE_KEY = 'emailVault'
const MAGIC_LINK_STORAGE_KEY = 'magicLinkKeys'

export type MagicLinkKeys = {
  [email: string]: MagicLinkKey
}

export class EmailVaultController extends EventEmitter {
  private storage: Storage

  private initialLoadPromise: Promise<void>

  #isWaitingEmailConfirmation: boolean = false

  #emailVault: EmailVault

  #magicLinkLifeTime: number = 300000

  #magicLinkKeys: MagicLinkKeys = {}

  #fetch: Function

  #relayerUrl: string

  #keystore: KeystoreController

  isReady: boolean = false

  lastUpdate: Date = new Date()

  emailVaultStates: {
    [email: string]: EmailVaultData
  } = {}

  constructor(storage: Storage, fetch: Function, relayerUrl: string, keystore: KeystoreController) {
    super()
    this.#fetch = fetch
    this.#relayerUrl = relayerUrl
    this.storage = storage
    this.#emailVault = new EmailVault(fetch, relayerUrl)
    this.#keystore = keystore
    this.initialLoadPromise = this.load()
  }

  private async load(): Promise<void> {
    this.isReady = false
    const result = await Promise.all([
      this.storage.get(EMAIL_VAULT_STORAGE_KEY, {}),
      this.storage.get(MAGIC_LINK_STORAGE_KEY, {})
    ])

    this.emailVaultStates = result[0]
    this.#magicLinkKeys = result[1]

    this.lastUpdate = new Date()
    this.isReady = true
    this.emitUpdate()
  }

  getCurrentState(): EmailVaultState {
    if (!this.isReady) return EmailVaultState.Loading
    if (this.#isWaitingEmailConfirmation) return EmailVaultState.WaitingEmailConfirmation
    return EmailVaultState.Ready
  }

  #verifiedMagicLinkKey(email: string) {
    if (!this.#magicLinkKeys[email]) return
    this.#magicLinkKeys[email].confirmed = true
    this.storage.set(MAGIC_LINK_STORAGE_KEY, this.#magicLinkKeys)
  }

  async #requestNewMagicLinkKey(email: string) {
    await this.initialLoadPromise
    const result = await requestMagicLink(email, this.#relayerUrl, this.#fetch)
    this.#magicLinkKeys[email] = {
      key: result.key,
      requestedAt: new Date(),
      confirmed: !!result.secret
    }
    this.storage.set(MAGIC_LINK_STORAGE_KEY, this.#magicLinkKeys)
    return this.#magicLinkKeys[email]
  }

  async #getMagicLinkKey(email: string): Promise<MagicLinkKey | null> {
    await this.initialLoadPromise
    const result = this.#magicLinkKeys[email]
    if (!result) return null
    if (new Date().getTime() - result.requestedAt.getTime() > this.#magicLinkLifeTime) return null
    return result
  }

  async backupRecoveryKeyStoreSecret(email: string) {
    if (!this.emailVaultStates[email]) {
      await this.login(email)
    }

    const newSecret = crypto.randomBytes(32).toString('base64url')

    await this.#keystore.addSecret(RECOVERY_SECRET_ID, newSecret, '', true)
    const keyStoreUid = await this.#keystore.getKeyStoreUid()
    const existsMagicKey = await this.#getMagicLinkKey(email)

    const magicKey = existsMagicKey || (await this.#requestNewMagicLinkKey(email))
    if (magicKey.confirmed) {
      await this.#emailVault.addKeyStoreSecret(email, magicKey.key, keyStoreUid, newSecret)
    }
    await this.polling(this.#addKeyStoreSecretProceed.bind(this), [
      email,
      magicKey.key,
      keyStoreUid,
      newSecret
    ])

    await this.getEmailVaultInfo(email)
  }

  async #addKeyStoreSecretProceed(
    email: string,
    magicKey: string,
    keyStoreUid: string,
    newSecret: string
  ) {
    this.#isWaitingEmailConfirmation = true
    if (!this.#magicLinkKeys[email]) {
      this.emitUpdate()
      return false
    }

    const result: Boolean | null = await this.#emailVault
      .addKeyStoreSecret(email, magicKey, keyStoreUid, newSecret)
      .catch(() => null)

    if (!result) {
      this.emitUpdate()
      return false
    }

    this.#isWaitingEmailConfirmation = false
    this.#verifiedMagicLinkKey(email)
    return true
  }

  async recoverKeyStore(email: string) {
    if (!this.emailVaultStates[email]) {
      await this.login(email)
    }
    const keyStoreUid = await this.#keystore.getKeyStoreUid()
    const availableSecrets = this.emailVaultStates[email].availableSecrets
    const keyStoreSecret = Object.keys(availableSecrets).find(async (secretKey: string) => {
      return availableSecrets[secretKey].key === keyStoreUid
    })
    if (this.emailVaultStates[email] && keyStoreSecret) {
      const secretKey = await this.getRecoverKeyStoreSecret(email, keyStoreUid)
      await this.#keystore.unlockWithSecret(RECOVERY_SECRET_ID, secretKey.value)
    }
  }

  async getRecoverKeyStoreSecret(email: string, uid: string): Promise<any> {
    const state = this.emailVaultStates
    if (
      !state[email] ||
      !state[email].availableSecrets[uid] ||
      state[email].availableSecrets[uid].type !== SecretType.KeyStore
    )
      return

    const existsMagicKey = await this.#getMagicLinkKey(email)
    const key = existsMagicKey || (await this.#requestNewMagicLinkKey(email))

    if (key.confirmed) {
      return this.#getRecoverKeyStoreSecretProceed(email, uid)
    }
    return this.polling(this.#getRecoverKeyStoreSecretProceed.bind(this), [email, uid])
  }

  async #getRecoverKeyStoreSecretProceed(email: string, uid: string) {
    this.#isWaitingEmailConfirmation = true
    if (!this.#magicLinkKeys[email]) {
      this.emitUpdate()
      return false
    }

    const result: EmailVaultSecrets | null = await this.#emailVault
      .retrieveKeyStoreSecret(email, this.#magicLinkKeys[email].key, uid)
      .catch(() => null)

    if (!result) {
      this.emitUpdate()
      return false
    }
    this.#isWaitingEmailConfirmation = false
    this.#verifiedMagicLinkKey(email)
    this.emitUpdate()
    return result
  }

  async login(email: string) {
    const existsMagicKey = await this.#getMagicLinkKey(email)

    const key = existsMagicKey || (await this.#requestNewMagicLinkKey(email))
    if (key.confirmed) {
      await this.getEmailVaultInfo(email)
    } else {
      await this.polling(this.getEmailVaultInfo.bind(this), [email])
    }
  }

  async getEmailVaultInfo(email: string): Promise<boolean | null> {
    this.#isWaitingEmailConfirmation = true
    if (!this.#magicLinkKeys[email]) {
      this.emitUpdate()
      return false
    }

    // ToDo if result not success
    const result: EmailVaultData | null = await this.#emailVault
      .getEmailVaultInfo(email, this.#magicLinkKeys[email].key)
      .catch(() => null)

    if (!result) {
      this.emitUpdate()
      return false
    }

    this.emailVaultStates[email] = result

    this.storage.set(EMAIL_VAULT_STORAGE_KEY, this.emailVaultStates)
    // this will trigger the update event
    this.#isWaitingEmailConfirmation = false
    this.#verifiedMagicLinkKey(email)
    this.emitUpdate()
    return true
  }

  async polling(fn: Function, params: any) {
    setTimeout(async () => {
      const result = await fn(...params)
      if (result) return result
      return this.polling(fn, params)
    }, 2000)
  }
}
