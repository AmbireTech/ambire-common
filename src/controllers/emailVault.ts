import crypto from 'crypto'
import { EmailVault } from '../libs/emailVault/emailVault'
import { requestMagicLink } from '../libs/magicLink/magicLink'
import { EmailVaultData, SecretType, EmailVaultSecret, Operation } from '../interfaces/emailVault'
import { Storage } from '../interfaces/storage'
import { Keystore } from '../libs/keystore/keystore'
import EventEmitter from '../libs/eventEmitter/eventEmitter'
import { Polling } from '../libs/polling/polling'

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
const SESSION_KEYS_STORAGE_KEY = 'sessionKeys'

export type MagicLinkKeys = {
  [email: string]: MagicLinkKey
}

export type SessionKeys = {
  [email: string]: string
}

export class EmailVaultController extends EventEmitter {
  private storage: Storage

  private initialLoadPromise: Promise<void>

  #isWaitingEmailConfirmation: boolean = false

  #emailVault: EmailVault

  #magicLinkLifeTime: number = 300000

  #magicLinkKeys: MagicLinkKeys = {}

  #sessionKeys: SessionKeys = {}

  #fetch: Function

  #relayerUrl: string

  #keyStore: Keystore

  isReady: boolean = false

  lastUpdate: Date = new Date()

  emailVaultStates: {
    email: { [email: string]: EmailVaultData }
    criticalError?: Error
    errors?: Error[]
  } = {
    email: {}
  }

  constructor(storage: Storage, fetch: Function, relayerUrl: string, keyStore: Keystore) {
    super()
    this.#fetch = fetch
    this.#relayerUrl = relayerUrl
    this.storage = storage
    this.#emailVault = new EmailVault(fetch, relayerUrl)
    this.#keyStore = keyStore
    this.initialLoadPromise = this.load()
  }

  private async load(): Promise<void> {
    this.isReady = false
    const result = await Promise.all([
      this.storage.get(EMAIL_VAULT_STORAGE_KEY, {
        email: {}
      }),
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

  // user workflow =====>
  // create account
  // login
  // forgoten password (for keystore)
  // request action
  // fullfil action

  // <=====
  // fetching funcs are private, async, supposed to be awaited and modify the this. (sometimes return T | null)
  // examples
  // auth: requestNewMagicLinkKey, requestSessionKey
  // vault: getEmailVaultInfo

  // get* functions lookup the storage, return a value and are supposed to be awaited
  //

  // public functions modify the state
  // in cases of
  // login - login() - should triger [some authentication, getEmailVaultInfo]
  async #requestSessionKey(email: string) {
    // if magicLinkKey => get sessionKey
    // <<==>>
    if (!this.#magicLinkKeys[email]) return
    this.#magicLinkKeys[email].confirmed = true
    this.#sessionKeys[email] = await this.#emailVault.getSessionKey(
      email,
      this.#magicLinkKeys[email].key
    )
    // <<==>>

    // store magicLinkKey and sessionKey
    // <<==>>
    await Promise.all([
      this.storage.set(MAGIC_LINK_STORAGE_KEY, this.#magicLinkKeys),
      this.storage.set(SESSION_KEYS_STORAGE_KEY, this.#sessionKeys)
    ])
    // <<==>>
  }

  async #handleMagicLinkKey(email: string, fn: Function) {
    await this.initialLoadPromise
    const oldKey = this.#magicLinkKeys[email]
    if (
      oldKey &&
      oldKey.confirmed &&
      oldKey.requestedAt.getTime() + this.#magicLinkLifeTime > new Date().getTime()
    ) {
      this.#isWaitingEmailConfirmation = false
      return
    }

    this.#isWaitingEmailConfirmation = true
    const newKey = await requestMagicLink(email, this.#relayerUrl, this.#fetch)
    const polling = new Polling()
    polling.onUpdate(() => {
      if (polling.state.isError && polling.state.error.output.res.status === 401) {
        this.#isWaitingEmailConfirmation = true
      } else if (polling.state.isError) {
        // @NOTE: we now have this.emitError()
        this.emailVaultStates.errors = [polling.state.error]
      } else {
        this.#magicLinkKeys[email] = {
          key: newKey.key,
          requestedAt: new Date(),
          confirmed: true
        }
        this.storage.set(MAGIC_LINK_STORAGE_KEY, this.#magicLinkKeys)
        fn()
        // @TODO add request for sessionKey
      }
      this.#requestSessionKey(email)
    })

    polling.exec(
      this.#emailVault.getEmailVaultInfo.bind(this.#emailVault),
      [email, newKey.key],
      15000,
      1000
    )
  }

  async #getSessionKey(email: string): Promise<string | null> {
    // <<==>>
    await this.initialLoadPromise
    return this.#sessionKeys[email]
    // <<==>>
  }

  async #getMagicLinkKey(email: string): Promise<MagicLinkKey | null> {
    // if we have valid magicLinkKey => returns it else null
    // <<==>>
    await this.initialLoadPromise
    const result = this.#magicLinkKeys[email]
    if (!result) return null
    if (new Date().getTime() - result.requestedAt.getTime() > this.#magicLinkLifeTime) return null
    return result
    // <<==>>
  }

  async getEmailVaultInfo(email: string): Promise<void> {
    const [existsSessionKey, magicLinkKey] = await Promise.all([
      this.#getSessionKey(email),
      this.#getMagicLinkKey(email)
    ])

    const key = existsSessionKey || magicLinkKey?.key

    let emailVault: EmailVaultData | null

    if (key) {
      emailVault = await this.#emailVault.getEmailVaultInfo(email, key).catch(() => null)
    } else {
      this.#handleMagicLinkKey(email, () => this.getEmailVaultInfo(email))
      return
    }

    if (emailVault) {
      this.emailVaultStates.errors = []
      this.emailVaultStates.email[email] = emailVault
      await this.storage.set(EMAIL_VAULT_STORAGE_KEY, this.emailVaultStates)
      if (!existsSessionKey) {
        await this.#requestSessionKey(email)
      }
    } else {
      this.emailVaultStates.errors = [new Error('error retrieving data for email vault')]
    }

    this.#isWaitingEmailConfirmation = false
    this.emitUpdate()
  }

  async uploadKeyStoreSecret(email: string) {
    if (!this.emailVaultStates.email[email]) {
      await this.getEmailVaultInfo(email)
    }

    let result: Boolean | null

    const newSecret = crypto.randomBytes(32).toString('base64url')

    await this.#keyStore.addSecret(RECOVERY_SECRET_ID, newSecret)
    const [keyStoreUid, magicKey] = await Promise.all([
      this.#keyStore.getKeyStoreUid(),
      this.#getMagicLinkKey(email)
    ])

    if (magicKey?.confirmed) {
      result = await this.#emailVault.addKeyStoreSecret(email, magicKey.key, keyStoreUid, newSecret)
    } else {
      this.#handleMagicLinkKey(email, () => this.uploadKeyStoreSecret(email))
      return
    }

    if (result) {
      await this.getEmailVaultInfo(email)
    } else {
      this.emailVaultStates.errors = [new Error('error upload keyStore to email vault')]
    }
  }

  // unlockViaEmailVault

  // async #addKeyStoreSecretProceed(
  //   email: string,
  //   magicKey: string,
  //   keyStoreUid: string,
  //   newSecret: string
  // ) {
  //   this.#isWaitingEmailConfirmation = true
  //   if (!this.#magicLinkKeys[email]) {
  //     this.emitUpdate()
  //     return false
  //   }

  //   const result: Boolean | null = await this.#emailVault
  //     .addKeyStoreSecret(email, magicKey, keyStoreUid, newSecret)
  //     .catch(() => null)

  //   if (!result) {
  //     this.emitUpdate()
  //     return false
  //   }

  //   this.#isWaitingEmailConfirmation = false
  //   await this.#requestSessionKey(email)
  //   return true
  // }

  // async recoverKeyStore(email: string) {
  //   if (!this.emailVaultStates.email[email]) {
  //     await this.getEmailVaultInfo(email)
  //   }
  //   const keyStoreUid = await this.#keyStore.getKeyStoreUid()
  //   const availableSecrets = this.emailVaultStates.email[email].availableSecrets
  //   const keyStoreSecret = Object.keys(availableSecrets).find(async (secretKey: string) => {
  //     return availableSecrets[secretKey].key === keyStoreUid
  //   })
  //   if (this.emailVaultStates.email[email] && keyStoreSecret) {
  //     const secretKey = await this.getRecoverKeyStoreSecret(email, keyStoreUid)
  //     console.log({ secretKey })

  //     // await this.#keyStore.unlockWithSecret(RECOVERY_SECRET_ID, secretKey.value)
  //   }
  // }

  async getKeyStoreSecret(email: string, uid: string): Promise<EmailVaultSecret | null> {
    const state = this.emailVaultStates
    if (
      !state.email[email] ||
      !state.email[email].availableSecrets[uid] ||
      state.email[email].availableSecrets[uid].type !== SecretType.KeyStore
    )
      return null

    const magicLinkKey = await this.#getMagicLinkKey(email)
    let result: EmailVaultSecret | null = null
    if (magicLinkKey?.confirmed) {
      const polling = new Polling()
      polling.onUpdate(() => {
        if (polling.state.isError && polling.state.error.output.res.status === 401) {
          this.#isWaitingEmailConfirmation = true
        } else if (polling.state.isError) {
          this.emailVaultStates.errors = [polling.state.error]
        }
      })

      result = await polling.exec(this.#emailVault.retrieveKeyStoreSecret, [
        email,
        magicLinkKey.key,
        uid
      ])
    } else {
      this.#handleMagicLinkKey(email, () => this.getKeyStoreSecret(email, uid))
      this.getEmailVaultInfo(email)
    }
    if (result) {
      this.emailVaultStates.email[email].availableSecrets[result.key] = result
      await this.storage.set(EMAIL_VAULT_STORAGE_KEY, this.emailVaultStates)
      this.emitUpdate()
      return result
    }
    this.emitUpdate()
    return null
  }

  async login(email: string) {
    const sessionKey = await this.#getSessionKey(email)
    const magicKey = await this.#getMagicLinkKey(email)
    const authKey = sessionKey || magicKey?.key

    if (authKey) {
      await this.getEmailVaultInfo(email)
    } else {
      this.#handleMagicLinkKey(email, () => this.login(email))
    }
  }

  async requestKeysSync(email: string, keys: string[]) {
    const [magicLinkKey, keyStoreUid] = await Promise.all([
      this.#getMagicLinkKey(email),
      this.#keyStore.getKeyStoreUid()
    ])

    const operations: Operation[] = keys.map((key) => ({
      requestType: 'requestKeySync',
      requester: keyStoreUid,
      key
    }))

    if (magicLinkKey) {
      const newOperations = await this.#emailVault.operations(email, magicLinkKey.key, operations)
      if (newOperations.length) this.emailVaultStates.email[email].operations = newOperations
      // @TODO polling for fulfilled sync request
      this.emitUpdate()
    } else {
      this.#handleMagicLinkKey(email, () => this.requestKeysSync(email, keys))
    }
  }
}
