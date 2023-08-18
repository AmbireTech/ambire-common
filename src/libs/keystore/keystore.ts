/* eslint-disable new-cap */
import aes from 'aes-js'
import { concat, getBytes, hexlify, keccak256, randomBytes, toUtf8Bytes, Wallet } from 'ethers'
import scrypt from 'scrypt-js'

import { KeystoreSigner } from '../../interfaces/keystore'
import { Storage } from '../../interfaces/storage'

const scryptDefaults = { N: 262144, r: 8, p: 1, dkLen: 64 }
const CIPHER = 'aes-128-ctr'

// DOCS
// - Secrets are strings that are used to encrypt the mainKey; the mainKey could be encrypted with many secrets
// - All individual keys are encrypted with the mainKey
// - The mainKey is kept in memory, but only for the unlockedTime

// Design decisions
// - decided to store all keys in the Keystore, even if the private key itself is not stored there; simply because it's called a Keystore and the name implies the functionality
// - handle HW wallets in it, so that we handle everything uniformly with a single API; also, it allows future flexibility to have the concept of optional unlocking built-in; if we have interactivity, we can add `keystore.signExtraInputRequired(key)` which returns what we need from the user
// - `signWithkey` is presumed to be non-interactive at least from `Keystore` point of view (requiring no extra user inputs). This could be wrong, if hardware wallets require extra input - they normally always do, but with the web SDKs we "outsource" this to the HW wallet software itself; this may not be true on mobile

type ScryptParams = {
  salt: string
  N: number
  r: number
  p: number
  dkLen: number
}

type AESEncrypted = {
  cipherType: string
  ciphertext: string
  iv: string
  mac: string
}

type MainKeyEncryptedWithSecret = {
  id: string
  scryptParams: ScryptParams
  aesEncrypted: AESEncrypted
}

type MainKey = {
  key: Uint8Array
  iv: Uint8Array
}

export type Key = {
  // normally in the form of an Ethereum address
  id: string
  type: string
  label: string
  isExternallyStored: boolean
  meta: object | null
}

export type StoredKey = {
  id: string
  type: string
  label: string
  privKey: string | null
  // denotes additional info like HW wallet derivation path
  meta: object | null
}

type KeystoreSignerType = {
  new (key: Key, privateKey?: string): KeystoreSigner
}

export class Keystore {
  #mainKey: MainKey | null

  storage: Storage

  keystoreSigners: { [key: string]: KeystoreSignerType }

  constructor(_storage: Storage, _keystoreSigners: { [key: string]: KeystoreSignerType }) {
    this.storage = _storage
    this.keystoreSigners = _keystoreSigners
    this.#mainKey = null
  }

  lock() {
    this.#mainKey = null
  }

  isUnlocked() {
    return !!this.#mainKey
  }

  async getMainKeyEncryptedWithSecrets(): Promise<MainKeyEncryptedWithSecret[]> {
    return this.storage.get('keystoreSecrets', [])
  }

  async isReadyToStoreKeys(): Promise<boolean> {
    return (await this.getMainKeyEncryptedWithSecrets()).length > 0
  }

  async getKeyStoreUid() {
    const uid = await this.storage.get('keyStoreUid', null)
    if (!uid) throw new Error('keystore: adding secret before get uid')
    return uid
  }

  // @TODO time before unlocking
  async unlockWithSecret(secretId: string, secret: string) {
    // @TODO should we check if already locked? probably not cause this function can  be used in order to verify if a secret is correct
    const secrets = await this.getMainKeyEncryptedWithSecrets()
    if (!secrets.length) throw new Error('keystore: no secrets yet')
    const secretEntry = secrets.find((x) => x.id === secretId)
    if (!secretEntry) throw new Error(`keystore: secret ${secretId} not found`)

    const { scryptParams, aesEncrypted } = secretEntry
    if (aesEncrypted.cipherType !== CIPHER)
      throw Error(`keystore: unsupported cipherType ${aesEncrypted.cipherType}`)
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
    if (mac !== aesEncrypted.mac) throw new Error('keystore: wrong secret')
    const decrypted = aesCtr.decrypt(getBytes(aesEncrypted.ciphertext))
    this.#mainKey = { key: decrypted.slice(0, 16), iv: decrypted.slice(16, 32) }
  }

  async addSecret(secretId: string, secret: string, extraEntropy: string = '', leaveUnlocked: boolean = false) {
    const secrets = await this.getMainKeyEncryptedWithSecrets()
    // @TODO test
    if (secrets.find((x) => x.id === secretId))
      throw new Error(`keystore: trying to add duplicate secret ${secretId}`)

    let mainKey: MainKey | null = this.#mainKey
    // We are not not unlocked
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
    await this.storage.set('keystoreSecrets', secrets)

    // produce uid if one doesn't exist (should be created when the first secret is added)
    if (!(await this.storage.get('keyStoreUid', null))) {
      const uid = keccak256(mainKey.key).slice(2, 34)
      await this.storage.set('keyStoreUid', uid)
    }
  }

  async removeSecret(secretId: string) {
    const secrets = await this.getMainKeyEncryptedWithSecrets()
    if (secrets.length <= 1)
      throw new Error('keystore: there would be no remaining secrets after removal')
    if (!secrets.find((x) => x.id === secretId))
      throw new Error(`keystore: secret$ ${secretId} not found`)
    await this.storage.set(
      'keystoreSecrets',
      secrets.filter((x) => x.id !== secretId)
    )
  }

  async getKeys(): Promise<Key[]> {
    const keys: [StoredKey] = await this.storage.get('keystoreKeys', [])
    return keys.map(
      ({ id, label, type, meta }) =>
        ({
          id,
          label,
          type,
          meta,
          isExternallyStored: type !== 'internal'
        } as Key)
    )
  }

  async addKeyExternallyStored(id: string, type: string, label: string, meta: object) {
    const keys: [StoredKey] = await this.storage.get('keystoreKeys', [])
    keys.push({
      id,
      type,
      label,
      meta,
      privKey: null
    })
    await this.storage.set('keystoreKeys', keys)
  }

  async addKey(privateKey: string, label: string) {
    if (this.#mainKey === null) throw new Error('keystore: needs to be unlocked')

    // Set up the cipher
    const counter = new aes.Counter(this.#mainKey.iv)
    const aesCtr = new aes.ModeOfOperation.ctr(this.#mainKey.key, counter)

    // Store the key
    // Terminology: this private key represents an EOA wallet, which is why ethers calls it Wallet, but we treat it as a key here
    const wallet = new Wallet(privateKey)
    const keys: [StoredKey] = await this.storage.get('keystoreKeys', [])
    keys.push({
      id: wallet.address,
      type: 'internal',
      label,
      // @TODO: consider an MAC?
      privKey: hexlify(aesCtr.encrypt(aes.utils.hex.toBytes(privateKey))),
      meta: null
    })
    await this.storage.set('keystoreKeys', keys)
  }

  async removeKey(id: string) {
    if (!this.isUnlocked()) throw new Error('keystore: not unlocked')
    const keys: [StoredKey] = await this.storage.get('keystoreKeys', [])
    if (!keys.find((x) => x.id === id))
      throw new Error(`keystore: trying to remove key that does not exist ${id}}`)
    this.storage.set(
      'keystoreKeys',
      keys.filter((x) => x.id !== id)
    )
  }

  async exportKeyWithPasscode(keyId: string, passphrase: string) {
    if (this.#mainKey === null) throw new Error('keystore: needs to be unlocked')
    const keys = await this.storage.get('keystoreKeys', [])
    const storedKey: StoredKey = keys.find((x: StoredKey) => x.id === keyId)

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

  async getSigner(keyId: string) {
    const keys = await this.storage.get('keystoreKeys', [])
    const storedKey: StoredKey = keys.find((x: StoredKey) => x.id === keyId)

    if (!storedKey) throw new Error('keystore: key not found')
    const { id, label, type, meta } = storedKey

    const key = {
      id,
      label,
      type,
      meta,
      isExternallyStored: type !== 'internal'
    }

    const signerInitializer = this.keystoreSigners[key.type]
    if (!signerInitializer) throw new Error('keystore: unsupported signer type')

    if (key.type === 'internal') {
      if (!this.isUnlocked()) throw new Error('keystore: not unlocked')

      const encryptedBytes = getBytes(storedKey.privKey as string)
      // @ts-ignore
      const counter = new aes.Counter(this.#mainKey.iv)
      // @ts-ignore
      const aesCtr = new aes.ModeOfOperation.ctr(this.#mainKey.key, counter)
      const decryptedBytes = aesCtr.decrypt(encryptedBytes)
      const decryptedPrivateKey = aes.utils.hex.fromBytes(decryptedBytes)

      return new signerInitializer(key, decryptedPrivateKey)
    }

    return new signerInitializer(key)
  }
}
function getBytesForSecret(secret: string): ArrayLike<number> {
  // see https://github.com/ethers-io/ethers.js/blob/v5/packages/json-wallets/src.ts/utils.ts#L19-L24
  return toUtf8Bytes(secret, 'NFKC')
}
