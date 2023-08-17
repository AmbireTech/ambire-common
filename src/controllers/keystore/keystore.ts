import EventEmitter from 'controllers/eventEmitter'
import { Keystore } from 'libs/keystore/keystore'

export class KeystoreController extends EventEmitter {
  #keystore: Keystore

  isReadyToStoreKeys: boolean = false

  isUnlocked: boolean = false

  unlockWithSecretStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'DONE'

  addSecretStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'DONE'

  removeSecretStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'DONE'

  addKeyStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'DONE'

  removeKeyStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'DONE'

  constructor(_keystore: Keystore) {
    super()

    this.#keystore = _keystore
  }

  setIsReadyToStoreKeys(_isReadyToStoreKeys: boolean) {
    this.isReadyToStoreKeys = _isReadyToStoreKeys
  }

  lock() {
    this.#keystore.lock()
    this.isUnlocked = false
    this.emitUpdate()
  }

  async unlockWithSecret(secretId: string, secret: string) {
    if (this.unlockWithSecretStatus !== 'INITIAL') return

    this.unlockWithSecretStatus = 'LOADING'
    this.emitUpdate()
    try {
      await this.#keystore.unlockWithSecret(secretId, secret)
      this.isUnlocked = true
    } catch (error) {
      // TODO: handle here by emitting the error
    }
    this.unlockWithSecretStatus = 'DONE'
    this.emitUpdate()
    this.unlockWithSecretStatus = 'INITIAL'
    this.emitUpdate()
  }

  async addSecret(secretId: string, secret: string, extraEntropy?: string) {
    if (this.addSecretStatus !== 'INITIAL') return

    this.addSecretStatus = 'LOADING'
    this.emitUpdate()
    try {
      await this.#keystore.addSecret(secretId, secret, extraEntropy)
    } catch (error) {
      // TODO: handle here by emitting the error
    }
    this.isReadyToStoreKeys = true
    this.addSecretStatus = 'DONE'
    this.emitUpdate()
  }

  async removeSecret(secretId: string) {
    if (this.removeSecretStatus !== 'INITIAL') return

    this.removeSecretStatus = 'LOADING'
    this.emitUpdate()
    try {
      await this.#keystore.removeSecret(secretId)
      const isReady = await this.#keystore.isReadyToStoreKeys()
      if (!isReady) {
        this.isReadyToStoreKeys = false
      }
    } catch (error) {
      // TODO: handle here by emitting the error
    }
    this.removeSecretStatus = 'DONE'
    this.emitUpdate()
  }

  async addKeyExternallyStored(id: string, type: string, label: string, meta: object) {
    if (this.addKeyStatus !== 'INITIAL') return

    this.addKeyStatus = 'LOADING'
    this.emitUpdate()
    try {
      await this.#keystore.addKeyExternallyStored(id, type, label, meta)
    } catch (error) {
      // TODO: handle here by emitting the error
    }
    this.addKeyStatus = 'DONE'
    this.emitUpdate()
  }

  async addKey(privateKey: string, label: string) {
    if (this.addKeyStatus !== 'INITIAL') return

    this.addKeyStatus = 'LOADING'
    this.emitUpdate()
    try {
      await this.#keystore.addKey(privateKey, label)
    } catch (error) {
      // TODO: handle here by emitting the error
    }
    this.addKeyStatus = 'DONE'
    this.emitUpdate()
  }

  async removeKey(id: string) {
    if (this.removeKeyStatus !== 'INITIAL') return

    this.removeKeyStatus = 'LOADING'
    this.emitUpdate()
    try {
      await this.#keystore.removeKey(id)
    } catch (error) {
      // TODO: handle here by emitting the error
    }
    this.removeKeyStatus = 'DONE'
    this.emitUpdate()
  }
}
