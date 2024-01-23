/* eslint-disable new-cap */
/* eslint-disable @typescript-eslint/no-shadow */
import aes from 'aes-js'
import { concat, getBytes, hexlify, keccak256, randomBytes, toUtf8Bytes, Wallet } from 'ethers'
import scrypt from 'scrypt-js'

import {
  ExternalKey,
  Key,
  KeystoreSignerType,
  MainKey,
  MainKeyEncryptedWithSecret,
  StoredKey
} from '../../interfaces/keystore'
import { Storage } from '../../interfaces/storage'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter'

const scryptDefaults = { N: 131072, r: 8, p: 1, dkLen: 64 }
const CIPHER = 'aes-128-ctr'

function getBytesForSecret(secret: string): ArrayLike<number> {
  // see https://github.com/ethers-io/ethers.js/blob/v5/packages/json-wallets/src.ts/utils.ts#L19-L24
  return toUtf8Bytes(secret, 'NFKC')
}

/**
 * The KeystoreController is a class that manages a collection of encrypted keys.
 * It provides methods for adding, removing, and retrieving keys. The keys are
 * encrypted using a main key, which is itself encrypted using one or more secrets.
 *
 * Docs:
 *   - Secrets are strings that are used to encrypt the mainKey; the mainKey
 *     could be encrypted with many secrets
 *   - All individual keys are encrypted with the mainKey
 *   - The mainKey is kept in memory, but only for the unlockedTime
 * Design decisions:
 *   - decided to store all keys in the Keystore, even if the private key itself
 *     is not stored there; simply because it's called a Keystore and the name
 *     implies the functionality
 *   - handle HW wallets in it, so that we handle everything uniformly with a
 *     single API; also, it allows future flexibility to have the concept of
 *     optional unlocking built-in; if we have interactivity, we can add
 *     `keystore.signExtraInputRequired(key)` which returns what we need from the user
 *   - `signWithkey` is presumed to be non-interactive at least from `Keystore`
 *     point of view (requiring no extra user inputs). This could be wrong, if
 *     hardware wallets require extra input - they normally always do, but with
 *     the web SDKs we "outsource" this to the HW wallet software itself;
 *     this may not be true on mobile
 */
export class KeystoreController extends EventEmitter {
  #mainKey: MainKey | null

  #storage: Storage

  #keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>

  keys: Key[] = []

  isReadyToStoreKeys: boolean = false

  status: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'DONE' = 'INITIAL'

  errorMessage: string = ''

  latestMethodCall: string | null = null

  constructor(
    _storage: Storage,
    _keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>
  ) {
    super()
    this.#storage = _storage
    this.#keystoreSigners = _keystoreSigners
    this.#mainKey = null

    this.#load()
  }

  async #load() {
    try {
      this.keys = await this.getKeys()
    } catch (e) {
      this.emitError({
        message:
          'Something went wrong when loading the Keystore. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('keystore: failed to pull keys from storage')
      })
    }

    try {
      this.isReadyToStoreKeys = (await this.getMainKeyEncryptedWithSecrets()).length > 0
    } catch (e) {
      this.emitError({
        message:
          'Something went wrong when initiating the Keystore. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('keystore: failed to getMainKeyEncryptedWithSecrets() from storage')
      })
    }

    this.emitUpdate()
  }

  lock() {
    this.#mainKey = null
    this.emitUpdate()
  }

  get isUnlocked() {
    return !!this.#mainKey
  }

  async getMainKeyEncryptedWithSecrets(): Promise<MainKeyEncryptedWithSecret[]> {
    return this.#storage.get('keystoreSecrets', [])
  }

  async getKeyStoreUid() {
    const uid = await this.#storage.get('keyStoreUid', null)
    if (!uid) throw new Error('keystore: adding secret before get uid')

    return uid
  }

  // @TODO time before unlocking
  async #unlockWithSecret(secretId: string, secret: string) {
    // @TODO should we check if already locked? probably not cause this function can  be used in order to verify if a secret is correct
    const secrets = await this.getMainKeyEncryptedWithSecrets()
    if (!secrets.length) {
      throw new Error('keystore: no secrets yet')
    }

    const secretEntry = secrets.find((x) => x.id === secretId)
    if (!secretEntry) {
      throw new Error(`keystore: secret not found: ${secretId}`)
    }

    const { scryptParams, aesEncrypted } = secretEntry
    if (aesEncrypted.cipherType !== CIPHER) {
      throw new Error(`keystore: unsupported cipherType ${aesEncrypted.cipherType}`)
    }
    // @TODO: progressCallback?

    const key = await scrypt.scrypt(
      getBytesForSecret(secret),
      getBytes(scryptParams.salt),
      scryptParams.N,
      scryptParams.r,
      scryptParams.p,
      scryptParams.dkLen,
      () => {}
    )
    const iv = getBytes(aesEncrypted.iv)
    const derivedKey = key.slice(0, 16)
    const macPrefix = key.slice(16, 32)
    const counter = new aes.Counter(iv)
    const aesCtr = new aes.ModeOfOperation.ctr(derivedKey, counter)
    const mac = keccak256(concat([macPrefix, aesEncrypted.ciphertext]))
    if (mac !== aesEncrypted.mac) {
      // Throw, because that's handled as a form field error
      throw new Error('keystore: wrong secret')
    }

    const decrypted = aesCtr.decrypt(getBytes(aesEncrypted.ciphertext))
    this.#mainKey = { key: decrypted.slice(0, 16), iv: decrypted.slice(16, 32) }
  }

  async unlockWithSecret(secretId: string, secret: string) {
    return this.#wrapKeystoreAction('unlockWithSecret', () =>
      this.#unlockWithSecret(secretId, secret)
    )
  }

  async #addSecret(
    secretId: string,
    secret: string,
    extraEntropy: string = '',
    leaveUnlocked: boolean = false
  ) {
    const secrets = await this.getMainKeyEncryptedWithSecrets()
    // @TODO test
    if (secrets.find((x) => x.id === secretId))
      throw new Error(`keystore: trying to add duplicate secret ${secretId}`)

    let mainKey: MainKey | null = this.#mainKey
    // We are not unlocked
    if (!mainKey) {
      if (!secrets.length) {
        const key = getBytes(keccak256(concat([randomBytes(32), toUtf8Bytes(extraEntropy)]))).slice(
          0,
          16
        )
        mainKey = {
          key,
          iv: randomBytes(16)
        }
      } else throw new Error('keystore: must unlock keystore before adding secret')

      if (leaveUnlocked) {
        this.#mainKey = mainKey
      }
    }

    const salt = randomBytes(32)
    const key = await scrypt.scrypt(
      getBytesForSecret(secret),
      salt,
      scryptDefaults.N,
      scryptDefaults.r,
      scryptDefaults.p,
      scryptDefaults.dkLen,
      () => {}
    )
    const iv = randomBytes(16)
    const derivedKey = key.slice(0, 16)
    const macPrefix = key.slice(16, 32)
    const counter = new aes.Counter(iv)
    const aesCtr = new aes.ModeOfOperation.ctr(derivedKey, counter)
    const ciphertext = aesCtr.encrypt(getBytes(concat([mainKey.key, mainKey.iv])))
    const mac = keccak256(concat([macPrefix, ciphertext]))

    secrets.push({
      id: secretId,
      scryptParams: { salt: hexlify(salt), ...scryptDefaults },
      aesEncrypted: {
        cipherType: CIPHER,
        ciphertext: hexlify(ciphertext),
        iv: hexlify(iv),
        mac: hexlify(mac)
      }
    })
    // Persist the new secrets
    await this.#storage.set('keystoreSecrets', secrets)

    // produce uid if one doesn't exist (should be created when the first secret is added)
    if (!(await this.#storage.get('keyStoreUid', null))) {
      const uid = keccak256(mainKey.key).slice(2, 34)
      await this.#storage.set('keyStoreUid', uid)
    }

    this.isReadyToStoreKeys = true
  }

  async addSecret(secretId: string, secret: string, extraEntropy: string, leaveUnlocked: boolean) {
    await this.#wrapKeystoreAction('addSecret', () =>
      this.#addSecret(secretId, secret, extraEntropy, leaveUnlocked)
    )
  }

  async #removeSecret(secretId: string) {
    const secrets = await this.getMainKeyEncryptedWithSecrets()
    if (secrets.length <= 1)
      throw new Error('keystore: there would be no remaining secrets after removal')
    if (!secrets.find((x) => x.id === secretId))
      throw new Error(`keystore: secret$ ${secretId} not found`)
    await this.#storage.set(
      'keystoreSecrets',
      secrets.filter((x) => x.id !== secretId)
    )
  }

  async removeSecret(secretId: string) {
    await this.#wrapKeystoreAction('removeSecret', () => this.#removeSecret(secretId))
  }

  async getKeys(): Promise<Key[]> {
    const keys: StoredKey[] = await this.#storage.get('keystoreKeys', [])

    return keys.map(({ addr, type, dedicatedToOneSA, meta }) => {
      // Written with this 'internal' type guard (if) on purpose, because this
      // way TypeScript will be able to narrow down the types properly and infer
      // the return type of the map function correctly.
      if (type === 'internal') {
        return { addr, type, dedicatedToOneSA, meta, isExternallyStored: false }
      }

      return {
        addr,
        type,
        dedicatedToOneSA,
        meta: meta as ExternalKey['meta'],
        isExternallyStored: true
      }
    })
  }

  async #addKeysExternallyStored(
    keysToAdd: {
      addr: Key['addr']
      type: Key['type']
      dedicatedToOneSA: boolean
      meta: Key['meta']
    }[]
  ) {
    if (!keysToAdd.length) return

    // Strip out keys with duplicated private keys. One unique key is enough.
    const uniqueKeys: { addr: Key['addr']; type: Key['type'] }[] = []
    const uniqueKeysToAdd = keysToAdd.filter(({ addr, type }) => {
      if (uniqueKeys.some((x) => x.addr === addr && x.type === type)) {
        return false
      }

      uniqueKeys.push({ addr, type })
      return true
    })

    if (!uniqueKeysToAdd.length) return

    const keys: [StoredKey] = await this.#storage.get('keystoreKeys', [])

    const newKeys = uniqueKeysToAdd
      .map(({ addr, type, dedicatedToOneSA, meta }) => ({
        addr,
        type,
        dedicatedToOneSA,
        meta,
        privKey: null
      }))
      // No need to re-add keys that are already added (with the same type / device)
      .filter(({ addr, type }) => !keys.some((x) => x.addr === addr && x.type === type))

    if (!newKeys.length) return

    const nextKeys = [...keys, ...newKeys]

    await this.#storage.set('keystoreKeys', nextKeys)
    this.keys = await this.getKeys()
  }

  async addKeysExternallyStored(
    keysToAdd: {
      addr: Key['addr']
      type: Key['type']
      dedicatedToOneSA: boolean
      meta: Key['meta']
    }[]
  ) {
    await this.#wrapKeystoreAction('addKeysExternallyStored', () =>
      this.#addKeysExternallyStored(keysToAdd)
    )
  }

  async #addKeys(keysToAdd: { privateKey: string; dedicatedToOneSA: boolean }[]) {
    if (!keysToAdd.length) return
    if (this.#mainKey === null) throw new Error('keystore: needs to be unlocked')

    // Strip out keys with duplicated private keys. One unique key is enough.
    const uniquePrivateKeysToAddSet = new Set()
    const uniqueKeysToAdd = keysToAdd.filter(({ privateKey }) => {
      if (!uniquePrivateKeysToAddSet.has(privateKey)) {
        uniquePrivateKeysToAddSet.add(privateKey)
        return true
      }
      return false
    })

    if (!uniqueKeysToAdd.length) return

    const keys: [StoredKey] = await this.#storage.get('keystoreKeys', [])

    const newKeys: StoredKey[] = uniqueKeysToAdd
      .map(({ privateKey, dedicatedToOneSA }) => {
        // eslint-disable-next-line no-param-reassign
        privateKey = privateKey.substring(0, 2) === '0x' ? privateKey.substring(2) : privateKey

        // Set up the cipher
        const counter = new aes.Counter(this.#mainKey!.iv) // TS compiler fails to detect we check for null above
        const aesCtr = new aes.ModeOfOperation.ctr(this.#mainKey!.key, counter) // TS compiler fails to detect we check for null above

        // Store the key
        // Terminology: this private key represents an EOA wallet, which is why ethers calls it Wallet, but we treat it as a key here
        const wallet = new Wallet(privateKey)
        return {
          addr: wallet.address,
          type: 'internal' as 'internal',
          dedicatedToOneSA,
          // @TODO: consider an MAC?
          privKey: hexlify(aesCtr.encrypt(aes.utils.hex.toBytes(privateKey))),
          meta: null
        }
      })
      // No need to re-add keys that are already added, private key never changes
      .filter(({ addr, type }) => !keys.some((x) => x.addr === addr && x.type === type))

    if (!newKeys.length) return

    const nextKeys = [...keys, ...newKeys]

    await this.#storage.set('keystoreKeys', nextKeys)
    this.keys = await this.getKeys()
  }

  async addKeys(keysToAdd: { privateKey: string; dedicatedToOneSA: boolean }[]) {
    await this.#wrapKeystoreAction('addKeys', () => this.#addKeys(keysToAdd))
  }

  async removeKey(addr: Key['addr'], type: Key['type']) {
    if (!this.isUnlocked) throw new Error('keystore: not unlocked')
    const keys: [StoredKey] = await this.#storage.get('keystoreKeys', [])
    if (!keys.find((x) => x.addr === addr && x.type === type))
      throw new Error(
        `keystore: trying to remove key that does not exist: address: ${addr}, type: ${type}`
      )

    await this.#storage.set(
      'keystoreKeys',
      keys.filter((x) => x.addr === addr && x.type === type)
    )
    this.keys = await this.getKeys()
  }

  async exportKeyWithPasscode(keyAddress: Key['addr'], keyType: Key['type'], passphrase: string) {
    if (this.#mainKey === null) throw new Error('keystore: needs to be unlocked')
    const keys = await this.#storage.get('keystoreKeys', [])
    const storedKey: StoredKey = keys.find(
      (x: StoredKey) => x.addr === keyAddress && x.type === keyType
    )

    if (!storedKey) throw new Error('keystore: key not found')
    if (storedKey.type !== 'internal') throw new Error('keystore: key does not have privateKey')

    const encryptedBytes = getBytes(storedKey.privKey as string)
    const counter = new aes.Counter(this.#mainKey.iv)
    const aesCtr = new aes.ModeOfOperation.ctr(this.#mainKey.key, counter)
    const decryptedBytes = aesCtr.decrypt(encryptedBytes)
    const decryptedPrivateKey = aes.utils.hex.fromBytes(decryptedBytes)
    const wallet = new Wallet(decryptedPrivateKey)
    const keyBackup = await wallet.encrypt(passphrase)
    return JSON.stringify(keyBackup)
  }

  async getSigner(keyAddress: Key['addr'], keyType: Key['type']) {
    const keys = await this.#storage.get('keystoreKeys', [])
    const storedKey: StoredKey = keys.find(
      (x: StoredKey) => x.addr === keyAddress && x.type === keyType
    )

    if (!storedKey) throw new Error('keystore: key not found')
    const { addr, type, dedicatedToOneSA, meta } = storedKey

    const key = {
      addr,
      type,
      dedicatedToOneSA,
      meta,
      isExternallyStored: type !== 'internal'
    }

    const SignerInitializer = this.#keystoreSigners[key.type]
    if (!SignerInitializer) throw new Error('keystore: unsupported signer type')

    if (key.type === 'internal') {
      if (!this.isUnlocked) throw new Error('keystore: not unlocked')

      const encryptedBytes = getBytes(storedKey.privKey as string)
      // @ts-ignore
      const counter = new aes.Counter(this.#mainKey.iv)
      // @ts-ignore
      const aesCtr = new aes.ModeOfOperation.ctr(this.#mainKey.key, counter)
      const decryptedBytes = aesCtr.decrypt(encryptedBytes)
      const decryptedPrivateKey = aes.utils.hex.fromBytes(decryptedBytes)

      // @ts-ignore TODO: Figure out the correct type definition
      return new SignerInitializer(key, decryptedPrivateKey)
    }

    // @ts-ignore TODO: Figure out the correct type definition
    return new SignerInitializer(key)
  }

  async #changeKeystorePassword(oldSecret: string, newSecret: string) {
    await this.#unlockWithSecret('password', oldSecret)
    if (!this.isUnlocked) throw new Error('keystore: not unlocked')

    const secrets = await this.getMainKeyEncryptedWithSecrets()
    await this.#storage.set(
      'keystoreSecrets',
      secrets.filter((x) => x.id !== 'password')
    )
    await this.#addSecret('password', newSecret, '', true)
  }

  async changeKeystorePassword(oldSecret: string, newSecret: string) {
    await this.#wrapKeystoreAction('changeKeystorePassword', () =>
      this.#changeKeystorePassword(oldSecret, newSecret)
    )
  }

  async #wrapKeystoreAction(callName: string, fn: Function) {
    if (this.status === 'LOADING') return
    this.latestMethodCall = callName
    this.errorMessage = ''
    this.status = 'LOADING'
    this.emitUpdate()
    try {
      await fn()
      this.status = 'SUCCESS'
      this.emitUpdate()
    } catch (error: any) {
      if (error?.message === 'keystore: wrong secret') {
        this.errorMessage = 'Invalid Device Password.'
      } else if (error?.message === 'keystore: not unlocked') {
        this.emitError({
          message: 'App not unlocked. Please try again or contact support if the problem persists.',
          level: 'major',
          error
        })
      } else if (error?.message === 'keystore: no secrets yet') {
        this.emitError({
          message:
            'Trying to unlock Ambire, but the lock mechanism was not fully configured yet. Please try again or contact support if the problem persists.',
          level: 'major',
          error
        })
      } else if (
        error?.message?.includes('keystore: secret not found:') ||
        error?.message?.includes('keystore: unsupported cipherType')
      ) {
        this.emitError({
          message:
            'Something went wrong when trying to unlock Ambire. Please try again or contact support if the problem persists.',
          level: 'major',
          error
        })
      } else {
        this.emitError({
          message: 'Keystore unexpected error. If the problem persists, please contact support.',
          level: 'major',
          error
        })
      }
    }

    // set status in the next tick to ensure the FE receives the 'SUCCESS' status
    await wait(1)
    this.status = 'DONE'
    this.emitUpdate()

    // reset the status in the next tick to ensure the FE receives the 'DONE' status
    await wait(1)
    if (this.latestMethodCall === callName) {
      this.status = 'INITIAL'
      this.emitUpdate()
    }
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
