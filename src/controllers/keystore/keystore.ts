import { Keystore } from '../../libs/keystore/keystore'
import EventEmitter from '../eventEmitter'

export class KeystoreController extends EventEmitter {
  #keystoreLib: Keystore

  isReadyToStoreKeys: boolean = false

  status: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

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

  async addSecret(secretId: string, secret: string, extraEntropy?: string) {
    await this.wrapKeystoreAction('addSecret', async () => {
      await this.#keystoreLib.addSecret(secretId, secret, extraEntropy)
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

  async addKeyExternallyStored(id: string, type: string, label: string, meta: object) {
    await this.wrapKeystoreAction('addKeyExternallyStored', async () =>
      this.#keystoreLib.addKeyExternallyStored(id, type, label, meta)
    )
  }

  async addKey(privateKey: string, label: string) {
    await this.wrapKeystoreAction('addKey', async () => this.#keystoreLib.addKey(privateKey, label))
  }

  async removeKey(id: string) {
    await this.wrapKeystoreAction('removeKey', async () => this.#keystoreLib.removeKey(id))
  }

  async wrapKeystoreAction(callName: string, fn: Function) {
    if (this.status !== 'INITIAL') return
    this.latestMethodCall = callName

    this.status = 'LOADING'
    this.emitUpdate()
    try {
      await fn()
    } catch (error) {
      console.log(error)
      // TODO: handle here by emitting the error
    }
    this.status = 'DONE'
    this.emitUpdate()
    this.status = 'INITIAL'
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      isUnlocked: this.isUnlocked // includes the getter in the stringified instance
    }
  }
}
