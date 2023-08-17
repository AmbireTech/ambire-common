import EventEmitter from 'controllers/eventEmitter'
import { Keystore } from 'libs/keystore/keystore'

export class KeystoreController extends EventEmitter {
  #keystoreLib: Keystore

  isReadyToStoreKeys: boolean = false

  isUnlocked: boolean = false

  unlockWithSecretStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'DONE'

  addSecretStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'DONE'

  removeSecretStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'DONE'

  addKeyStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'DONE'

  removeKeyStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'DONE'

  constructor(_keystoreLib: Keystore) {
    super()

    this.#keystoreLib = _keystoreLib
  }

  setIsReadyToStoreKeys(_isReadyToStoreKeys: boolean) {
    this.isReadyToStoreKeys = _isReadyToStoreKeys
  }

  lock() {
    this.#keystoreLib.lock()
    this.isUnlocked = false
    this.emitUpdate()
  }

  async unlockWithSecret(secretId: string, secret: string) {
    if (this.unlockWithSecretStatus !== 'INITIAL') return

    this.unlockWithSecretStatus = 'LOADING'
    this.emitUpdate()
    try {
      await this.#keystoreLib.unlockWithSecret(secretId, secret)
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
      await this.#keystoreLib.addSecret(secretId, secret, extraEntropy)
    } catch (error) {
      // TODO: handle here by emitting the error
    }
    this.isReadyToStoreKeys = true
    this.addSecretStatus = 'DONE'
    this.emitUpdate()
    this.addSecretStatus = 'INITIAL'
    this.emitUpdate()
  }

  async removeSecret(secretId: string) {
    if (this.removeSecretStatus !== 'INITIAL') return

    this.removeSecretStatus = 'LOADING'
    this.emitUpdate()
    try {
      await this.#keystoreLib.removeSecret(secretId)
      const isReady = await this.#keystoreLib.isReadyToStoreKeys()
      if (!isReady) {
        this.isReadyToStoreKeys = false
      }
    } catch (error) {
      // TODO: handle here by emitting the error
    }
    this.removeSecretStatus = 'DONE'
    this.emitUpdate()
    this.removeSecretStatus = 'INITIAL'
    this.emitUpdate()
  }

  async addKeyExternallyStored(id: string, type: string, label: string, meta: object) {
    if (this.addKeyStatus !== 'INITIAL') return

    this.addKeyStatus = 'LOADING'
    this.emitUpdate()
    try {
      await this.#keystoreLib.addKeyExternallyStored(id, type, label, meta)
    } catch (error) {
      // TODO: handle here by emitting the error
    }
    this.addKeyStatus = 'DONE'
    this.emitUpdate()
    this.addKeyStatus = 'INITIAL'
    this.emitUpdate()
  }

  async addKey(privateKey: string, label: string) {
    if (this.addKeyStatus !== 'INITIAL') return

    this.addKeyStatus = 'LOADING'
    this.emitUpdate()
    try {
      await this.#keystoreLib.addKey(privateKey, label)
    } catch (error) {
      // TODO: handle here by emitting the error
    }
    this.addKeyStatus = 'DONE'
    this.emitUpdate()
    this.addKeyStatus = 'INITIAL'
    this.emitUpdate()
  }

  async removeKey(id: string) {
    if (this.removeKeyStatus !== 'INITIAL') return

    this.removeKeyStatus = 'LOADING'
    this.emitUpdate()
    try {
      await this.#keystoreLib.removeKey(id)
    } catch (error) {
      // TODO: handle here by emitting the error
    }
    this.removeKeyStatus = 'DONE'
    this.emitUpdate()
    this.removeKeyStatus = 'INITIAL'
    this.emitUpdate()
  }
}
