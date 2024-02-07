/* eslint-disable class-methods-use-this */
/* eslint-disable no-await-in-loop */
import crypto from 'crypto'

import { Banner } from '../../interfaces/banner'
import {
  EmailVaultData,
  EmailVaultSecret,
  EmailVaultOperation,
  SecretType,
  OperationRequestType
} from '../../interfaces/emailVault'
import { Storage } from '../../interfaces/storage'
import { getKeySyncBanner } from '../../libs/banners/banners'
import { EmailVault } from '../../libs/emailVault/emailVault'
import EventEmitter, { ErrorRef } from '../eventEmitter/eventEmitter'
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

function base64UrlEncode(str: string) {
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * EmailVaultController
 * @class
 * The purpouse of this controller is to provide easy interface to the EmailVault, keystore and magic link libraries
 * The most important thing it achieves is handling magicLink and session keys with polling.
 * Emits the porper states e.g. loading, ready, awaiting email magicLink confirmation etc.
 * Extended documentation about the EV and its internal mechanisms
 * https://github.com/AmbireTech/ambire-common/wiki/Email-Vault-Documentation
 */
export class EmailVaultController extends EventEmitter {
  private storage: Storage

  private initialLoadPromise: Promise<void>

  #isWaitingEmailConfirmation: boolean = false

  #emailVault: EmailVault

  #magicLinkLifeTime: number = 300000

  #magicLinkKeys: MagicLinkKeys = {}

  #sessionKeys: SessionKeys = {}

  #shouldStopConfirmationPolling: boolean = false

  #autoConfirmMagicLink: boolean = false

  #fetch: Function

  #relayerUrl: string

  #keyStore: KeystoreController

  isReady: boolean = false

  lastUpdate: Date = new Date()

  latestMethodStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  latestMethodCall: string | null = null

  emailVaultStates: {
    email: { [email: string]: EmailVaultData }
    criticalError?: Error
    errors?: Error[]
  } = {
    email: {}
  }

  constructor(
    storage: Storage,
    fetch: Function,
    relayerUrl: string,
    keyStore: KeystoreController,
    options?: { autoConfirmMagicLink?: boolean }
  ) {
    super()
    this.#fetch = fetch
    this.#relayerUrl = relayerUrl
    this.storage = storage
    this.#emailVault = new EmailVault(fetch, relayerUrl)
    this.#keyStore = keyStore
    this.initialLoadPromise = this.load()
    this.#autoConfirmMagicLink = options?.autoConfirmMagicLink || false
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
    const key = (await this.#getMagicLinkKey(email))?.key
    if (!key) return
    this.#sessionKeys[email] = await this.#emailVault.getSessionKey(email, key)

    // store magicLinkKey and sessionKey
    await Promise.all([
      this.storage.set(MAGIC_LINK_STORAGE_KEY, this.#magicLinkKeys),
      this.storage.set(SESSION_KEYS_STORAGE_KEY, this.#sessionKeys)
    ])
  }

  async handleMagicLinkKey(email: string, fn: Function) {
    await this.initialLoadPromise
    const currentKey = (await this.#getMagicLinkKey(email))?.key
    if (currentKey) {
      this.#isWaitingEmailConfirmation = false
      this.emitUpdate()
      return
    }

    this.#isWaitingEmailConfirmation = true
    this.emitUpdate()

    const newKey = await requestMagicLink(email, this.#relayerUrl, this.#fetch, {
      autoConfirm: this.#autoConfirmMagicLink
    })

    const polling = new Polling()
    polling.onUpdate(async () => {
      if (polling.state.isError && polling.state.error.output.res.status === 401) {
        this.#isWaitingEmailConfirmation = true
        this.emitUpdate()
      } else if (polling.state.isError) {
        this.emitError({
          message: `Can't request magic link for email ${email}: ${polling.state.error.message}`,
          level: 'major',
          error: new Error(
            `Can't request magic link for email ${email}: ${polling.state.error.message}`
          )
        })
        this.emailVaultStates.errors = [polling.state.error]
        this.emitUpdate()
      }
    })

    const ev: any = await polling.exec(
      this.#emailVault.getEmailVaultInfo.bind(this.#emailVault),
      [email, newKey.key],
      () => {
        this.#isWaitingEmailConfirmation = false
      },
      () => this.#shouldStopConfirmationPolling,
      15000,
      1000
    )

    if (ev && !ev.error) {
      this.#isWaitingEmailConfirmation = false
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
    await this.initialLoadPromise
    return this.#sessionKeys[email]
  }

  async #getMagicLinkKey(email: string): Promise<MagicLinkKey | null> {
    // if we have valid magicLinkKey => returns it else null
    await this.initialLoadPromise
    const result = this.#magicLinkKeys[email]
    if (!result || !result.confirmed) return null
    if (new Date().getTime() - result.requestedAt.getTime() > this.#magicLinkLifeTime) return null
    return result
  }

  #parseMagicLinkKeys(mks: any): MagicLinkKeys {
    return Object.fromEntries(
      Object.keys(mks).map((email) => [
        email,
        { ...mks[email], requestedAt: new Date(mks[email].requestedAt) }
      ])
    )
  }

  async getEmailVaultInfo(email: string) {
    await this.#wrapEmailVaultPublicMethod('getEmailVaultInfo', () =>
      this.#getEmailVaultInfo(email)
    )
  }

  async #getEmailVaultInfo(email: string): Promise<void> {
    const [existsSessionKey, magicLinkKey] = await Promise.all([
      this.#getSessionKey(email),
      this.#getMagicLinkKey(email)
    ])
    const key = existsSessionKey || magicLinkKey?.key

    let emailVault: EmailVaultData | null = null
    if (key) {
      emailVault = await this.#emailVault.getEmailVaultInfo(email, key).catch((e: any) => {
        this.emitError({
          message: `Error getting email vault for ${email} ${e.message}`,
          level: 'major',
          error: new Error(`Error getting email vault for ${email} ${e.message}`)
        })
        this.emailVaultStates.errors = []
        this.emailVaultStates.errors = [new Error('error retrieving data for email vault')]

        return null
      })
    } else {
      await this.handleMagicLinkKey(email, () => this.#getEmailVaultInfo(email))
    }

    if (emailVault) {
      this.emailVaultStates.email[email] = emailVault
      await this.storage.set(EMAIL_VAULT_STORAGE_KEY, this.emailVaultStates)
      if (!existsSessionKey) {
        await this.#requestSessionKey(email)
      }
    }

    this.#isWaitingEmailConfirmation = false
    this.emitUpdate()
  }

  async uploadKeyStoreSecret(email: string) {
    await this.#wrapEmailVaultPublicMethod('uploadKeyStoreSecret', () =>
      this.#uploadKeyStoreSecret(email)
    )
  }

  async #uploadKeyStoreSecret(email: string) {
    if (!this.emailVaultStates.email[email]) {
      await this.#getEmailVaultInfo(email)
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
      await this.handleMagicLinkKey(email, () => this.#uploadKeyStoreSecret(email))
    }

    if (result) {
      await this.#getEmailVaultInfo(email)
    } else {
      this.emailVaultStates.errors = [new Error('error upload keyStore to email vault')]
    }
  }

  async recoverKeyStore(email: string, newPassword: string) {
    await this.#wrapEmailVaultPublicMethod('recoverKeyStore', () =>
      this.#recoverKeyStore(email, newPassword)
    )
  }

  async #recoverKeyStore(email: string, newPassword: string): Promise<EmailVaultSecret | null> {
    const uid = await this.#keyStore.getKeyStoreUid()
    const state = this.emailVaultStates
    if (!state.email[email]) {
      this.emitError({
        message: `Keystore recovery: email ${email} not imported`,
        level: 'major',
        error: new Error(`Keystore recovery: email ${email} not imported`)
      })
      return null
    }

    if (!state.email[email].availableSecrets[uid]) {
      this.emitError({
        message: 'Keystore recovery: no keystore secret for this device',
        level: 'major',
        error: new Error('Keystore recovery: no keystore secret for this device')
      })
      return null
    }
    if (state.email[email].availableSecrets[uid].type !== SecretType.KeyStore) {
      this.emitError({
        message: `Keystore recovery: no keystore secret for email ${email}`,
        level: 'major',
        error: new Error(`Keystore recovery: no keystore secret for email ${email}`)
      })
      return null
    }

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
      // @TODO shouldn't this be in polling.exec too?
      result = await this.#emailVault.retrieveKeyStoreSecret(email, key, uid)
    } else {
      await this.handleMagicLinkKey(email, () => this.#recoverKeyStore(email, newPassword))
    }
    if (result && !result.error) {
      this.emailVaultStates.email[email].availableSecrets[result.key] = result

      await this.#keyStore.unlockWithSecret(RECOVERY_SECRET_ID, result.value)
      await this.#keyStore.addSecret('password', newPassword, '', false)

      await this.storage.set(EMAIL_VAULT_STORAGE_KEY, this.emailVaultStates)
      this.emitUpdate()
      return result
    }

    this.emitUpdate()
    return null
  }

  async requestKeysSync(email: string, keys: string[]) {
    await this.#wrapEmailVaultPublicMethod('requestKeysSync', () =>
      this.#requestKeysSync(email, keys)
    )
  }

  async #requestKeysSync(email: string, keys: string[]) {
    const [magicLinkKey, keyStoreUid] = await Promise.all([
      this.#getMagicLinkKey(email),
      this.#keyStore.getKeyStoreUid()
    ])

    const operations: EmailVaultOperation[] = keys.map((key) => ({
      type: OperationRequestType.requestKeySync,
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
    }
    await this.handleMagicLinkKey(email, () => this.#requestKeysSync(email, keys))
  }

  async #finalizeSyncKeys(email: string, operations: EmailVaultOperation[]) {
    const authKey = (await this.#getMagicLinkKey(email))?.key || (await this.#getSessionKey(email))
    if (authKey) {
      const cloudOperations = await this.#emailVault
        .getOperations(email, authKey, operations)
        .catch((e) => {
          this.emitError({
            message: `Can't pull operations: ${e}`,
            level: 'major',
            error: new Error(`Can't pull operations: ${e}`)
          })
        })
      if (!cloudOperations) {
        this.emitError({
          message: "Can't pull operations",
          level: 'major',
          error: new Error("Can't pull operations")
        })
      }

      // Promise.all makes race conditions
      for (let i = 0; i < cloudOperations!.length; i++) {
        const op = cloudOperations![i]
        if (op.type === 'requestKeySync' && op.value) {
          const { privateKey } = JSON.parse(op.value || '{}')
          await this.#keyStore.importKeyWithPublicKeyEncryption(privateKey, true)
        }
      }
      this.emitUpdate()
    } else {
      await this.handleMagicLinkKey(email, () => this.#finalizeSyncKeys(email, operations))
    }
  }

  async finalizeSyncKeys(email: string, keys: string[], password: string) {
    const operations: any[] = keys
      .map((key) => {
        const res = this.emailVaultStates.email[email].operations.find((op) => op.key === key)
        if (!res) {
          this.emitError({
            message: `No sync request for key ${key}`,
            level: 'major',
            error: new Error(`No sync request for key ${key}`)
          })
          return null
        }
        return { ...res, password }
      })
      .filter((x) => x)
    await this.#wrapEmailVaultPublicMethod('finalizeSyncRequest', () =>
      this.#finalizeSyncKeys(email, operations)
    )
  }

  // DOCS
  // this function:
  // - checks if there are sync requests via the operations route of the relayer
  // - exports the encrypted private key and sends it back to the relayer (fulfills)
  // @TODO add password
  async fulfillSyncRequests(email: string, password: string) {
    await this.#getEmailVaultInfo(email)
    const operations = this.emailVaultStates.email[email].operations
    const key = (await this.#getMagicLinkKey(email))?.key || (await this.#getSessionKey(email))
    if (key) {
      // pull keys from keystore for every operation
      const newOperations: EmailVaultOperation[] = await Promise.all(
        operations.map(async (op): Promise<EmailVaultOperation> => {
          if (op.type === 'requestKeySync') {
            return {
              ...op,
              value: JSON.stringify({
                privateKey: await this.#keyStore.exportKeyWithPublicKeyEncryption(
                  op.key,
                  op.requester
                )
              }),
              password
            }
          }
          return op
        })
      )
      await this.#emailVault.operations(email, key, newOperations)
      this.emitUpdate()
    } else {
      await this.handleMagicLinkKey(email, () => this.fulfillSyncRequests(email, password))
    }
    this.emitUpdate()
  }

  async #wrapEmailVaultPublicMethod(callName: string, fn: Function) {
    if (this.latestMethodStatus === 'LOADING') return
    this.latestMethodCall = callName
    this.latestMethodStatus = 'LOADING'
    this.emitUpdate()
    try {
      await fn()
    } catch (error: any) {
      this.emitError({
        message: 'Email vault unexpected error. If the problem persists, please contact support.',
        level: 'major',
        error
      })
    }
    this.latestMethodStatus = 'DONE'
    this.emitUpdate()

    await wait(1)
    if (this.latestMethodCall === callName) {
      this.latestMethodStatus = 'INITIAL'
      this.emitUpdate()
    }
  }

  cancelEmailConfirmation() {
    this.#shouldStopConfirmationPolling = true
    this.#isWaitingEmailConfirmation = false
  }

  get hasKeystoreRecovery() {
    const keyStoreUid = this.#keyStore.keyStoreUid
    const EVEmails = Object.keys(this.emailVaultStates.email)

    if (!keyStoreUid || !EVEmails.length) return false

    return !!EVEmails.find((email) => {
      return (
        this.emailVaultStates.email[email].availableSecrets[keyStoreUid]?.type ===
        SecretType.KeyStore
      )
    })
  }

  get banners(): Banner[] {
    const banners: Banner[] = []

    if (!this.hasKeystoreRecovery) {
      banners.push({
        id: 'keystore-secret-backup',
        topic: 'WARNING',
        title: 'Enable device password reset via email',
        text: "Email Vault recovers your Device Password. It is securely stored in Ambire's infrastructure cloud.",
        actions: [
          {
            label: 'Enable',
            actionName: 'backup-keystore-secret'
          }
        ]
      })
    }

    Object.keys(this.emailVaultStates.email).forEach((email) => {
      const emailVaultData = this.emailVaultStates?.email?.[email]
      Object.values(emailVaultData.availableAccounts || {}).forEach((accInfo) => {
        const keystoreKeys = this.#keyStore.keys.filter((key) =>
          accInfo.associatedKeys.includes(key.addr)
        )

        if (keystoreKeys.length) return
        banners.push(getKeySyncBanner(accInfo.addr, email, accInfo.associatedKeys))
      })
    })

    return banners
  }

  toJSON() {
    return {
      ...this,
      currentState: this.currentState, // includes the getter in the stringified instance
      hasKeystoreRecovery: this.hasKeystoreRecovery,
      banners: this.banners // includes the getter in the stringified instance,
    }
  }
}
