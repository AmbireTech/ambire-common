/* eslint-disable class-methods-use-this */
/* eslint-disable no-await-in-loop */
import crypto from 'crypto'

import {
  EmailVaultData,
  EmailVaultSecret,
  Operation,
  SecretType
} from '../../interfaces/emailVault'
import { Storage } from '../../interfaces/storage'
import { EmailVault } from '../../libs/emailVault/emailVault'
import EventEmitter from '../../libs/eventEmitter/eventEmitter'
import { requestMagicLink } from '../../libs/magicLink/magicLink'
import { Polling } from '../../libs/polling/polling'
import wait from '../../utils/wait'
import { KeystoreController } from '../keystore/keystore'

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

function base64UrlEncode(str) {
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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

  #keyStore: KeystoreController

  isReady: boolean = false

  lastUpdate: Date = new Date()

  emailVaultStates: {
    email: { [email: string]: EmailVaultData }
    criticalError?: Error
    errors?: Error[]
  } = {
    email: {}
  }

  constructor(storage: Storage, fetch: Function, relayerUrl: string, keyStore: KeystoreController) {
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
    this.emitUpdate()
    const result = await Promise.all([
      this.storage.get(EMAIL_VAULT_STORAGE_KEY, {
        email: {}
      }),
      this.storage.get(MAGIC_LINK_STORAGE_KEY, {})
    ])

    this.emailVaultStates = result[0]
    this.#magicLinkKeys = this.#parseMagicLinkKeys(result[1])

    this.lastUpdate = new Date()
    this.isReady = true
    this.emitUpdate()
  }

  get currentState(): EmailVaultState {
    if (!this.isReady) return EmailVaultState.Loading
    if (this.#isWaitingEmailConfirmation) return EmailVaultState.WaitingEmailConfirmation
    return EmailVaultState.Ready
  }

  async #requestSessionKey(email: string) {
    // if magicLinkKey => get sessionKey
    // <<==>>
    const key = (await this.#getMagicLinkKey(email))?.key
    if (!key) return
    this.#sessionKeys[email] = await this.#emailVault.getSessionKey(email, key)
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
    const currentKey = (await this.#getMagicLinkKey(email))?.key
    if (currentKey) {
      this.#isWaitingEmailConfirmation = false
      this.emitUpdate()
      return
    }

    this.#isWaitingEmailConfirmation = true
    this.emitUpdate()

    const newKey = await requestMagicLink(email, this.#relayerUrl, this.#fetch)
    const polling = new Polling()
    polling.onUpdate(async () => {
      if (polling.state.isError && polling.state.error.output.res.status === 401) {
        this.#isWaitingEmailConfirmation = true
        this.emitUpdate()
      } else if (polling.state.isError) {
        // @NOTE: we now have this.emitError()
        this.emailVaultStates.errors = [polling.state.error]
        this.emitUpdate()
      }
    })

    const ev: any = await polling.exec(
      this.#emailVault.getEmailVaultInfo.bind(this.#emailVault),
      [email, newKey.key],
      15000,
      1000
    )
    if (ev && !ev.error) {
      this.#magicLinkKeys[email] = {
        key: newKey.key,
        requestedAt: new Date(),
        confirmed: true
      }
      await fn()
      this.storage.set(MAGIC_LINK_STORAGE_KEY, this.#magicLinkKeys)
      this.#requestSessionKey(email)
    }
    this.emitUpdate()
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
    if (!result || !result.confirmed) return null
    if (new Date().getTime() - result.requestedAt.getTime() > this.#magicLinkLifeTime) return null
    return result
    // <<==>>
  }

  #parseMagicLinkKeys(mks: any): MagicLinkKeys {
    return Object.fromEntries(
      Object.keys(mks).map((email) => [
        email,
        { ...mks[email], requestedAt: new Date(mks[email].requestedAt) }
      ])
    )
  }

  async getEmailVaultInfo(email: string): Promise<void> {
    const [existsSessionKey, magicLinkKey] = await Promise.all([
      this.#getSessionKey(email),
      this.#getMagicLinkKey(email)
    ])
    const key = existsSessionKey || magicLinkKey?.key

    let emailVault: EmailVaultData | null = null
    if (key) {
      emailVault = await this.#emailVault.getEmailVaultInfo(email, key) // .catch(() => null)
    } else {
      await this.#handleMagicLinkKey(email, () => this.getEmailVaultInfo(email))
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

    let result: Boolean | null = false
    const magicKey = await this.#getMagicLinkKey(email)
    if (magicKey?.key) {
      const randomBytes = crypto.randomBytes(32)
      // toString('base64url') doesn't work for some reason in the browser extension
      const newSecret = base64UrlEncode(randomBytes.toString('base64'))
      await this.#keyStore.addSecret(RECOVERY_SECRET_ID, newSecret, '', false)
      const keyStoreUid = await this.#keyStore.getKeyStoreUid()
      result = await this.#emailVault.addKeyStoreSecret(email, magicKey.key, keyStoreUid, newSecret)
    } else {
      await this.#handleMagicLinkKey(email, () => this.uploadKeyStoreSecret(email))
    }

    if (result) {
      await this.getEmailVaultInfo(email)
    } else {
      this.emailVaultStates.errors = [new Error('error upload keyStore to email vault')]
    }
  }

  async recoverKeyStore(email: string): Promise<EmailVaultSecret | null> {
    const uid = await this.#keyStore.getKeyStoreUid()
    const state = this.emailVaultStates
    if (
      !state.email[email] ||
      !state.email[email].availableSecrets[uid] ||
      state.email[email].availableSecrets[uid].type !== SecretType.KeyStore
    )
      return null

    const key = (await this.#getMagicLinkKey(email))?.key
    let result: any = null
    if (key) {
      const polling = new Polling()
      polling.onUpdate(() => {
        if (polling.state.isError && polling.state.error.output.res.status === 401) {
          this.#isWaitingEmailConfirmation = true
          this.emitUpdate()
        } else if (polling.state.isError) {
          this.emailVaultStates.errors = [polling.state.error]
        }
      })

      result = await this.#emailVault.retrieveKeyStoreSecret(email, key, uid)
    } else {
      await this.#handleMagicLinkKey(email, () => this.getEmailVaultInfo(email))
    }
    if (result && !result.error) {
      this.emailVaultStates.email[email].availableSecrets[result.key] = result

      await this.#keyStore.unlockWithSecret(RECOVERY_SECRET_ID, result.value)
      await this.storage.set(EMAIL_VAULT_STORAGE_KEY, this.emailVaultStates)
      this.emitUpdate()
      return result
    }

    this.emitUpdate()
    return null
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
      const newOperations = (await this.#emailVault.operations(
        email,
        magicLinkKey.key,
        operations
      ))!
      this.emailVaultStates.email[email].operations = newOperations
      this.emitUpdate()
      await this.#handleKeysSync(email, newOperations)
    }
    await this.#handleMagicLinkKey(email, () => this.requestKeysSync(email, keys))
  }

  async #handleKeysSync(email: string, operations: Operation[]) {
    let fulfilled = false
    const requestedKeys = operations.map((op) => op.key)
    while (!fulfilled) {
      const authKey =
        (await this.#getMagicLinkKey(email))?.key || (await this.#getSessionKey(email))
      if (authKey) {
        // eslint-disable-next-line no-await-in-loop
        const cloudOperations = (await this.#emailVault.getEmailVaultInfo(email, authKey))
          ?.operations
        if (!cloudOperations) this.emailVaultStates.errors?.push(new Error('No keys to sync'))

        fulfilled = !!cloudOperations
          ?.filter((op) => requestedKeys.includes(op.key))
          .map((op) => !!op.value)
          .reduce((a, b) => a && b, !!cloudOperations.length)

        if (fulfilled) {
          // @TODO actually add them to the keystore
          for (let i = 0; i < cloudOperations!.length; i++) {
            const op = cloudOperations![i]
            const { privateKey, label } = JSON.parse(op?.value || '{}')
            if (op.requestType === 'requestKeySync') {
              await this.#keyStore.importKeyWithPublicKeyEncryption(privateKey, label)
            }
          }
          this.emailVaultStates.email[email].operations = cloudOperations!
          this.emitUpdate()
          return
        }
        await wait(500)
      } else {
        await this.#handleMagicLinkKey(email, () => this.#handleKeysSync(email, operations))
      }
    }
  }

  // DOCS
  // this function:
  // - checks if there are sync requests via the operations route of the relayer
  // - exports the encrypted private key and sends it back to the relayer (fulfills)
  async fulfillSyncRequests(email: string) {
    await this.getEmailVaultInfo(email)
    const operations = this.emailVaultStates.email[email].operations
    const storedKeys = await this.#keyStore.getKeys()
    const key = (await this.#getMagicLinkKey(email))?.key || (await this.#getSessionKey(email))
    if (key) {
      const newOperations: Operation[] = await Promise.all(
        operations.map(async (op): Promise<Operation> => {
          if (op.requestType === 'requestKeySync') {
            const label = storedKeys.find((k) => k.addr === op.key)?.label
            return {
              ...op,
              value: JSON.stringify({
                label,
                privateKey: await this.#keyStore.exportKeyWithPublicKeyEncryption(
                  op.key,
                  op.requester
                )
              })
            }
          }
          return op
        })
      )
      await this.#emailVault.operations(email, key, newOperations)
      this.emitUpdate()
    } else {
      await this.#handleMagicLinkKey(email, () => this.fulfillSyncRequests(email))
    }
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      currentState: this.currentState // includes the getter in the stringified instance
    }
  }
}
