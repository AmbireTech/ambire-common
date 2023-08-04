import crypto from 'crypto'
import { EmailVault } from '../libs/emailVault/emailVault'
import { requestMagicLink } from '../libs/magicLink/magicLink'
import { EmailVaultData, SecretType, EmailVaultSecret } from '../interfaces/emailVault'
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

  async #verifiedMagicLinkKey(email: string) {
    if (!this.#magicLinkKeys[email]) return
    this.#magicLinkKeys[email].confirmed = true
    this.#sessionKeys[email] = await this.#emailVault.getSessionKey(
      email,
      this.#magicLinkKeys[email].key
    )
    await Promise.all([
      this.storage.set(MAGIC_LINK_STORAGE_KEY, this.#magicLinkKeys),
      this.storage.set(SESSION_KEYS_STORAGE_KEY, this.#sessionKeys)
    ])
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

  async #getSessionKey(email: string): Promise<string | null> {
    await this.initialLoadPromise
    return this.#sessionKeys[email]
  }

  async #getMagicLinkKey(email: string): Promise<MagicLinkKey | null> {
    await this.initialLoadPromise
    const result = this.#magicLinkKeys[email]
    if (!result) return null
    if (new Date().getTime() - result.requestedAt.getTime() > this.#magicLinkLifeTime) return null
    return result
  }

  async getEmailVaultInfo(email: string): Promise<void> {
    const [existsSessionKey, existsMagicKey] = await Promise.all([
      this.#getSessionKey(email),
      this.#getMagicLinkKey(email)
    ])

    const magicLinkKey = existsMagicKey || (await this.#requestNewMagicLinkKey(email))
    const key = existsSessionKey || magicLinkKey.key

    let result: EmailVaultData | null

    if (!!existsSessionKey || magicLinkKey.confirmed) {
      result = await this.#emailVault.getEmailVaultInfo(email, key).catch(() => null)
    } else {
      this.#isWaitingEmailConfirmation = true
      const polling = new Polling()
      polling.onUpdate(() => {
        if (polling.state.isError && polling.state.error.output.res.status === 401) {
          this.#isWaitingEmailConfirmation = true
        } else if (polling.state.isError) {
          this.emailVaultStates.errors = [polling.state.error]
        }
      })

      result = await polling.exec(this.#emailVault.getEmailVaultInfo.bind(this.#emailVault), [
        email,
        key
      ])
    }

    if (result) {
      this.emailVaultStates.errors = []
      this.emailVaultStates.email[email] = result
      await this.storage.set(EMAIL_VAULT_STORAGE_KEY, this.emailVaultStates)
      if (!existsMagicKey && !magicLinkKey.confirmed) {
        await this.#verifiedMagicLinkKey(email)
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
    const [keyStoreUid, existsMagicKey] = await Promise.all([
      this.#keyStore.getKeyStoreUid(),
      this.#getMagicLinkKey(email)
    ])

    const magicKey = existsMagicKey || (await this.#requestNewMagicLinkKey(email))

    if (magicKey.confirmed) {
      result = await this.#emailVault.addKeyStoreSecret(email, magicKey.key, keyStoreUid, newSecret)
    } else {
      this.#isWaitingEmailConfirmation = true
      const polling = new Polling()
      polling.onUpdate(() => {
        if (polling.state.isError && polling.state.error.output.res.status === 401) {
          this.#isWaitingEmailConfirmation = true
        } else if (polling.state.isError) {
          this.emailVaultStates.errors = [polling.state.error]
        }
      })

      result = await polling.exec(this.#emailVault.addKeyStoreSecret.bind(this.#emailVault), [
        email,
        magicKey.key,
        keyStoreUid,
        newSecret
      ])
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
  //   await this.#verifiedMagicLinkKey(email)
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

    const existsMagicKey = await this.#getMagicLinkKey(email)
    const key = existsMagicKey || (await this.#requestNewMagicLinkKey(email))

    const polling = new Polling()
    polling.onUpdate(() => {
      if (polling.state.isError && polling.state.error.output.res.status === 401) {
        this.#isWaitingEmailConfirmation = true
      } else if (polling.state.isError) {
        this.emailVaultStates.errors = [polling.state.error]
      }
    })

    const result: EmailVaultSecret | null = await polling.exec(
      this.#emailVault.retrieveKeyStoreSecret,
      [email, key, uid]
    )

    console.log(result)

    return result

    //

    // if (!!existsSessionKey || magicLinkKey.confirmed) {

    // } else {
    //   this.#isWaitingEmailConfirmation = true
    //   const polling = new Polling()
    //   polling.onUpdate(() => {
    //     if (polling.state.isError && polling.state.error.output.res.status === 401) {
    //       this.#isWaitingEmailConfirmation = true
    //     } else if (polling.state.isError) {
    //       this.emailVaultStates.errors = [polling.state.error]
    //     }
    //   })

    //   result = await polling.exec(this.#emailVault.getEmailVaultInfo, [email, key])
    // }

    // this.emailVaultStates.email[email] = result!

    // this.storage.set(EMAIL_VAULT_STORAGE_KEY, this.emailVaultStates)
    // // this will trigger the update event
    // this.#isWaitingEmailConfirmation = false
    // if (!existsMagicKey && !magicLinkKey.confirmed) await this.#verifiedMagicLinkKey(email)
    // this.emitUpdate()
    // return true
  }

  // async getRecoverKeyStoreSecretOld(email: string, uid: string): Promise<any> {
  //   const state = this.emailVaultStates
  //   if (
  //     !state.email[email] ||
  //     !state.email[email].availableSecrets[uid] ||
  //     state.email[email].availableSecrets[uid].type !== SecretType.KeyStore
  //   )
  //     return

  //   const existsMagicKey = await this.#getMagicLinkKey(email)
  //   const key = existsMagicKey || (await this.#requestNewMagicLinkKey(email))

  //   if (key.confirmed) {
  //     return this.#getRecoverKeyStoreSecretProceed(email, uid)
  //   }
  //   return this.oldPolling(this.#getRecoverKeyStoreSecretProceed.bind(this), [email, uid])
  // }

  // async #getRecoverKeyStoreSecretProceed(email: string, uid: string) {
  //   this.#isWaitingEmailConfirmation = true
  //   if (!this.#magicLinkKeys[email]) {
  //     this.emitUpdate()
  //     return false
  //   }

  //   const result: EmailVaultSecret | null = await this.#emailVault
  //     .retrieveKeyStoreSecret(email, this.#magicLinkKeys[email].key, uid)
  //     .catch(() => null)

  //   if (!result) {
  //     this.emitUpdate()
  //     return false
  //   }
  //   this.#isWaitingEmailConfirmation = false
  //   await this.#verifiedMagicLinkKey(email)
  //   this.emitUpdate()
  //   return result
  // }

  // async login(email: string) {
  //   const [existsSessionKey, existsMagicKey] = await Promise.all([
  //     this.#getSessionKey(email),
  //     this.#getMagicLinkKey(email)
  //   ])

  //   const magicLinkKey = existsMagicKey || (await this.#requestNewMagicLinkKey(email))
  //   const key = existsSessionKey || magicLinkKey.key
  //   if (existsSessionKey || magicLinkKey.confirmed) {
  //     await this.getEmailVaultInfo1(email, key)
  //   } else {
  //     await this.polling(this.getEmailVaultInfo1.bind(this), [email, key])
  //   }
  // }

  // async getEmailVaultInfo1(email: string, key: string): Promise<boolean | null> {
  //   this.#isWaitingEmailConfirmation = true

  //   // ToDo if result not success
  //   const result: EmailVaultData | null = await this.#emailVault
  //     .getEmailVaultInfo(email, key)
  //     .catch(() => null)

  //   if (!result) {
  //     this.emitUpdate()
  //     return false
  //   }

  //   this.emailVaultStates[email] = result

  //   this.storage.set(EMAIL_VAULT_STORAGE_KEY, this.emailVaultStates)
  //   // this will trigger the update event
  //   this.#isWaitingEmailConfirmation = false
  //   await this.#verifiedMagicLinkKey(email)
  //   this.emitUpdate()
  //   return true
  // }

  async requestKeysSync(email: string, keys: string[]) {
    const [existsMagicKey, keyStoreUid] = await Promise.all([
      this.#getMagicLinkKey(email),
      this.#keyStore.getKeyStoreUid()
    ])

    const magicLinkKey = existsMagicKey || (await this.#requestNewMagicLinkKey(email))
    const authKey = magicLinkKey.key

    const operations = keys.map((key) => ({
      requestType: 'requestKeySync',
      requester: keyStoreUid,
      key
    }))

    if (magicLinkKey.confirmed) {
      await this.#emailVault.operations(email, authKey, operations)
    } else {
      // await this.polling(this.getEmailVaultInfo.bind(this), [email, key])
    }
  }

  async oldPolling(fn: Function, params: any) {
    setTimeout(async () => {
      const result = await fn(...params)
      if (result) return result
      return this.oldPolling(fn, params)
    }, 2000)
  }
}
