import { Key, Keystore } from '../../libs/keystore/keystore'
import EventEmitter from '../../libs/eventEmitter/eventEmitter'

export class KeystoreController extends EventEmitter {
  #keystoreLib: Keystore

  isReadyToStoreKeys: boolean = false

  status: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  errorMessage: string = ''

  latestMethodCall: string | null = null

  constructor(_keystoreLib: Keystore) {
    super()

    this.#keystoreLib = _keystoreLib
  }

  get isUnlocked(): boolean {
    return this.#keystoreLib.isUnlocked()
  }

  setIsReadyToStoreKeys(_isReadyToStoreKeys: boolean) {
    this.isReadyToStoreKeys = _isReadyToStoreKeys
  }

  lock() {
    this.#keystoreLib.lock()
    this.emitUpdate()
  }

  async unlockWithSecret(secretId: string, secret: string) {
    await this.wrapKeystoreAction('unlockWithSecret', async () =>
      this.#keystoreLib.unlockWithSecret(secretId, secret)
    )
  }

  async addSecret(secretId: string, secret: string, extraEntropy: string, leaveUnlocked: boolean) {
    await this.wrapKeystoreAction('addSecret', async () => {
      await this.#keystoreLib.addSecret(secretId, secret, extraEntropy, leaveUnlocked)
      this.isReadyToStoreKeys = true
    })
  }

  async removeSecret(secretId: string) {
    await this.wrapKeystoreAction('removeSecret', async () => {
      await this.#keystoreLib.removeSecret(secretId)
      const isReady = await this.#keystoreLib.isReadyToStoreKeys()
      if (!isReady) {
        this.isReadyToStoreKeys = false
      }
    })
  }

  async addKeysExternallyStored(
    keys: { addr: Key['addr']; type: Key['type']; label: Key['label']; meta: Key['meta'] }[]
  ) {
    await this.wrapKeystoreAction('addKeysExternallyStored', () =>
      this.#keystoreLib.addKeysExternallyStored(keys)
    )
  }

  async addKeys(keys: { privateKey: string; label: Key['label'] }[]) {
    await this.wrapKeystoreAction('addKeys', () => this.#keystoreLib.addKeys(keys))
  }

  async removeKey(addr: Key['addr'], type: Key['type']) {
    await this.wrapKeystoreAction('removeKey', async () => this.#keystoreLib.removeKey(addr, type))
  }

  async wrapKeystoreAction(callName: string, fn: Function) {
    if (this.status !== 'INITIAL') return
    this.latestMethodCall = callName
    this.errorMessage = ''
    this.status = 'LOADING'
    this.emitUpdate()
    try {
      await fn()
    } catch (error: any) {
      if (error?.message === 'keystore: wrong secret') {
        this.errorMessage = 'Invalid Key Store passphrase.'
      } else {
        this.emitError({
          message: 'Keystore unexpected error. If the problem persists, please contact support.',
          level: 'major',
          error
        })
      }
    }
    this.status = 'DONE'
    this.emitUpdate()
    this.status = 'INITIAL'
    this.emitUpdate()
  }

  resetErrorState() {
    this.errorMessage = ''
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      isUnlocked: this.isUnlocked // includes the getter in the stringified instance
    }
  }
}
