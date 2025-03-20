/* eslint-disable class-methods-use-this */
/* eslint-disable new-cap */
/* eslint-disable @typescript-eslint/no-shadow */
import aes from 'aes-js'
// import { entropyToMnemonic } from 'bip39'
import {
  decryptWithPrivateKey,
  Encrypted,
  encryptWithPublicKey,
  publicKeyByPrivateKey
} from 'eth-crypto'
import { concat, getBytes, hexlify, keccak256, Mnemonic, toUtf8Bytes, Wallet } from 'ethers'
import { Account } from 'interfaces/account'
import scrypt from 'scrypt-js'

import EmittableError from '../../classes/EmittableError'
import { DERIVATION_OPTIONS, HD_PATH_TEMPLATE_TYPE } from '../../consts/derivation'
import { Banner } from '../../interfaces/banner'
import {
  ExternalKey,
  InternalKey,
  Key,
  KeyPreferences,
  KeystoreSeed,
  KeystoreSignerInterface,
  KeystoreSignerType,
  MainKey,
  MainKeyEncryptedWithSecret,
  ReadyToAddKeys,
  StoredKey
} from '../../interfaces/keystore'
import { WindowManager } from '../../interfaces/window'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { EntropyGenerator } from '../../libs/entropyGenerator/entropyGenerator'
import { getDefaultKeyLabel } from '../../libs/keys/keys'
import shortenAddress from '../../utils/shortenAddress'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'
import { StorageController } from '../storage/storage'

const scryptDefaults = { N: 131072, r: 8, p: 1, dkLen: 64 }
const CIPHER = 'aes-128-ctr'
const KEYSTORE_UNEXPECTED_ERROR_MESSAGE =
  'Keystore unexpected error. If the problem persists, please contact support.'

const STATUS_WRAPPED_METHODS = {
  unlockWithSecret: 'INITIAL',
  addSecret: 'INITIAL',
  addSeed: 'INITIAL',
  moveTempSeedToKeystoreSeeds: 'INITIAL',
  deleteSavedSeed: 'INITIAL',
  removeSecret: 'INITIAL',
  addKeys: 'INITIAL',
  addKeysExternallyStored: 'INITIAL',
  changeKeystorePassword: 'INITIAL',
  updateKeyPreferences: 'INITIAL'
} as const

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

  // Secrets are strings that are used to encrypt the mainKey.
  // The mainKey could be encrypted with many secrets.
  #keystoreSecrets: MainKeyEncryptedWithSecret[] = []

  #storage: StorageController

  #keystoreSeeds: KeystoreSeed[] = []

  // when importing a seed, save it temporary here before deciding
  // whether to place it in #keystoreSeeds or delete it
  //
  // this should be done only if there isn't a saved seed already
  #tempSeed: KeystoreSeed | null = null

  #keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>

  #keystoreKeys: StoredKey[] = []

  keyStoreUid: string | null

  isReadyToStoreKeys: boolean = false

  errorMessage: string = ''

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  #windowManager: WindowManager

  constructor(
    _storage: StorageController,
    _keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>,
    windowManager: WindowManager
  ) {
    super()
    this.#storage = _storage
    this.#keystoreSigners = _keystoreSigners
    this.#mainKey = null
    this.keyStoreUid = null
    this.#windowManager = windowManager

    this.#initialLoadPromise = this.#load()
  }

  async #load() {
    try {
      const [keystoreSeeds, keyStoreUid, keystoreKeys] = await Promise.all([
        this.#storage.get('keystoreSeeds', []),
        this.#storage.get('keyStoreUid', null),
        this.#storage.get('keystoreKeys', [])
      ])
      this.keyStoreUid = keyStoreUid
      this.#keystoreSeeds = keystoreSeeds
      this.#keystoreKeys = keystoreKeys
    } catch (e) {
      this.emitError({
        message:
          'Something went wrong when loading the Keystore. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('keystore: failed to pull keys from storage')
      })
    }

    try {
      this.#keystoreSecrets = await this.#storage.get('keystoreSecrets', [])
      this.isReadyToStoreKeys = this.#keystoreSecrets.length > 0
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
    if (this.#tempSeed) this.deleteTempSeed(false)
    this.emitUpdate()
  }

  get isUnlocked() {
    return !!this.#mainKey
  }

  async getKeyStoreUid() {
    const uid = this.keyStoreUid
    if (!uid) throw new Error('keystore: adding secret before get uid')

    return uid
  }

  // @TODO time before unlocking
  async #unlockWithSecret(secretId: string, secret: string) {
    await this.#initialLoadPromise

    // @TODO should we check if already locked? probably not cause this function can  be used in order to verify if a secret is correct
    if (!this.#keystoreSecrets.length) {
      throw new EmittableError({
        message:
          'Trying to unlock Ambire, but the lock mechanism was not fully configured yet. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('keystore: no secrets yet')
      })
    }

    const secretEntry = this.#keystoreSecrets.find((x) => x.id === secretId)
    if (!secretEntry) {
      throw new EmittableError({
        message:
          'Something went wrong when trying to unlock Ambire. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('keystore: secret not found')
      })
    }

    const { scryptParams, aesEncrypted } = secretEntry
    if (aesEncrypted.cipherType !== CIPHER) {
      throw new EmittableError({
        message:
          'Something went wrong when trying to unlock Ambire. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error(`keystore: unsupported cipherType ${aesEncrypted.cipherType}`)
      })
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
      this.errorMessage = 'Incorrect password. Please try again.'
      this.emitUpdate()

      const error = new Error(this.errorMessage)
      throw new EmittableError({ level: 'silent', message: this.errorMessage, error })
    }
    this.errorMessage = ''

    const decrypted = aesCtr.decrypt(getBytes(aesEncrypted.ciphertext))
    this.#mainKey = { key: decrypted.slice(0, 16), iv: decrypted.slice(16, 32) }
  }

  async unlockWithSecret(secretId: string, secret: string) {
    await this.withStatus('unlockWithSecret', () => this.#unlockWithSecret(secretId, secret))
  }

  async #addSecret(
    secretId: string,
    secret: string,
    extraEntropy: string = '',
    leaveUnlocked: boolean = false
  ) {
    await this.#initialLoadPromise

    // @TODO test
    if (this.#keystoreSecrets.find((x) => x.id === secretId))
      throw new EmittableError({
        message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
        level: 'major',
        error: new Error(`keystore: trying to add duplicate secret ${secretId}`)
      })

    let mainKey: MainKey | null = this.#mainKey
    const entropyGenerator = new EntropyGenerator()

    // We are not unlocked
    if (!mainKey) {
      if (!this.#keystoreSecrets.length) {
        mainKey = {
          key: entropyGenerator.generateRandomBytes(16, extraEntropy),
          iv: entropyGenerator.generateRandomBytes(16, extraEntropy)
        }
      } else
        throw new EmittableError({
          message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
          level: 'major',
          error: new Error('keystore: must unlock keystore before adding secret')
        })

      if (leaveUnlocked) {
        this.#mainKey = mainKey
      }
    }

    const salt = entropyGenerator.generateRandomBytes(32, extraEntropy)
    const key = await scrypt.scrypt(
      getBytesForSecret(secret),
      salt,
      scryptDefaults.N,
      scryptDefaults.r,
      scryptDefaults.p,
      scryptDefaults.dkLen,
      () => {}
    )
    const iv = entropyGenerator.generateRandomBytes(16, extraEntropy)
    const derivedKey = key.slice(0, 16)
    const macPrefix = key.slice(16, 32)
    const counter = new aes.Counter(iv)
    const aesCtr = new aes.ModeOfOperation.ctr(derivedKey, counter)
    const ciphertext = aesCtr.encrypt(getBytes(concat([mainKey.key, mainKey.iv])))
    const mac = keccak256(concat([macPrefix, ciphertext]))

    this.#keystoreSecrets.push({
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
    await this.#storage.set('keystoreSecrets', this.#keystoreSecrets)

    // produce uid if one doesn't exist (should be created when the first secret is added)
    if (!this.keyStoreUid) {
      const uid = publicKeyByPrivateKey(hexlify(getBytes(concat([mainKey.key, mainKey.iv]))))
      this.keyStoreUid = uid
      await this.#storage.set('keyStoreUid', uid)
    }

    this.isReadyToStoreKeys = true
  }

  async addSecret(secretId: string, secret: string, extraEntropy: string, leaveUnlocked: boolean) {
    await this.withStatus('addSecret', () =>
      this.#addSecret(secretId, secret, extraEntropy, leaveUnlocked)
    )
  }

  async #removeSecret(secretId: string) {
    await this.#initialLoadPromise

    if (!this.#keystoreSecrets.find((x) => x.id === secretId))
      throw new EmittableError({
        message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
        level: 'major',
        error: new Error(`keystore: secret$ ${secretId} not found`)
      })

    this.#keystoreSecrets = this.#keystoreSecrets.filter((x) => x.id !== secretId)
    await this.#storage.set('keystoreSecrets', this.#keystoreSecrets)
  }

  async removeSecret(secretId: string) {
    await this.withStatus('removeSecret', () => this.#removeSecret(secretId))
  }

  get keys(): Key[] {
    return this.#keystoreKeys.map(({ addr, type, label, dedicatedToOneSA, meta }) => {
      // Written with this 'internal' type guard (if) on purpose, because this
      // way TypeScript will be able to narrow down the types properly and infer
      // the return type of the map function correctly.
      if (type === 'internal') {
        return {
          addr,
          type,
          label,
          dedicatedToOneSA,
          meta,
          isExternallyStored: false
        }
      }

      return {
        addr,
        type,
        label,
        dedicatedToOneSA,
        meta: meta as ExternalKey['meta'],
        isExternallyStored: true
      }
    })
  }

  async #getEncryptedSeedPhrase(
    seed: KeystoreSeed['seed'],
    seedPassphrase?: KeystoreSeed['seedPassphrase']
  ): Promise<{
    seed: string
    passphrase: string | null
  }> {
    await this.#initialLoadPromise

    if (this.#mainKey === null)
      throw new EmittableError({
        message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
        level: 'major',
        error: new Error('keystore: needs to be unlocked')
      })

    if (!Mnemonic.isValidMnemonic(seed)) {
      throw new EmittableError({
        message: 'You are trying to store an invalid seed phrase.',
        level: 'major',
        error: new Error('keystore: trying to add an invalid seed phrase')
      })
    }

    // Currently we support only one seed phrase to be added to the keystore
    // this fist seed phrase will become the saved seed phrase of the wallet
    if (this.#keystoreSeeds.length) {
      throw new EmittableError({
        message: 'You can have only one saved seed in the extension',
        level: 'major',
        error: new Error(
          'keystore: seed phase already added. Storing multiple seed phrases not supported yet'
        )
      })
    }

    // Set up the cipher
    const counter = new aes.Counter(this.#mainKey!.iv) // TS compiler fails to detect we check for null above
    const aesCtr = new aes.ModeOfOperation.ctr(this.#mainKey!.key, counter) // TS compiler fails to detect we check for null above\
    return {
      seed: hexlify(aesCtr.encrypt(new TextEncoder().encode(seed))),
      passphrase: seedPassphrase
        ? hexlify(aesCtr.encrypt(new TextEncoder().encode(seedPassphrase)))
        : null
    }
  }

  async addSeedToTemp({ seed, seedPassphrase, hdPathTemplate }: KeystoreSeed) {
    const validHdPath = DERIVATION_OPTIONS.some((o) => o.value === hdPathTemplate)
    if (!validHdPath)
      throw new EmittableError({
        message:
          'Incorrect derivation path when trying to update the temp seed. Please contact support',
        level: 'major',
        error: new Error('keystore: hd path to temp seed incorrect')
      })

    const { seed: seedPhrase, passphrase } = await this.#getEncryptedSeedPhrase(
      seed,
      seedPassphrase
    )

    this.#tempSeed = { seed: seedPhrase, seedPassphrase: passphrase, hdPathTemplate }

    this.emitUpdate()
  }

  deleteTempSeed(shouldUpdate = true) {
    this.#tempSeed = null
    if (shouldUpdate) this.emitUpdate()
  }

  async #moveTempSeedToKeystoreSeeds() {
    if (this.#mainKey === null)
      throw new EmittableError({
        message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
        level: 'major',
        error: new Error('keystore: needs to be unlocked')
      })

    // Currently we support only one seed phrase to be added to the keystore
    // this fist seed phrase will become the saved seed phrase of the wallet
    if (this.#keystoreSeeds.length) {
      throw new EmittableError({
        message: 'You can have only one saved seed in the extension',
        level: 'major',
        error: new Error(
          'keystore: seed phase already added. Storing multiple seed phrases not supported yet'
        )
      })
    }

    if (!this.#tempSeed) {
      throw new EmittableError({
        message:
          'Imported seed no longer exists in the extension. If you want to save it, please re-import it',
        level: 'major',
        error: new Error('keystore: imported seed deleted although a request to save it was made')
      })
    }

    this.#keystoreSeeds.push(this.#tempSeed)
    await this.#storage.set('keystoreSeeds', this.#keystoreSeeds)
    this.#tempSeed = null
    this.emitUpdate()
  }

  async moveTempSeedToKeystoreSeeds() {
    await this.#initialLoadPromise
    await this.withStatus('moveTempSeedToKeystoreSeeds', () => this.#moveTempSeedToKeystoreSeeds())
  }

  async #addSeed({ seed, seedPassphrase, hdPathTemplate }: KeystoreSeed) {
    const { seed: seedPhrase, passphrase } = await this.#getEncryptedSeedPhrase(
      seed,
      seedPassphrase
    )

    this.#keystoreSeeds.push({ seed: seedPhrase, seedPassphrase: passphrase, hdPathTemplate })
    await this.#storage.set('keystoreSeeds', this.#keystoreSeeds)

    this.emitUpdate()
  }

  async addSeed(keystoreSeed: KeystoreSeed) {
    await this.withStatus('addSeed', () => this.#addSeed(keystoreSeed))
  }

  async changeTempSeedHdPathTemplateIfNeeded(nextHdPathTemplate?: HD_PATH_TEMPLATE_TYPE) {
    if (!nextHdPathTemplate) return // should never happen

    await this.#initialLoadPromise

    if (!this.isUnlocked) throw new Error('keystore: not unlocked')
    if (!this.#tempSeed) throw new Error('keystore: no temp seed at the moment')

    const isTheSameHdPathTemplate = this.#tempSeed.hdPathTemplate === nextHdPathTemplate
    if (isTheSameHdPathTemplate) return

    this.#tempSeed.hdPathTemplate = nextHdPathTemplate

    this.emitUpdate()
  }

  async changeSavedSeedHdPathTemplateIfNeeded(nextHdPathTemplate?: HD_PATH_TEMPLATE_TYPE) {
    if (!nextHdPathTemplate) return // should never happen

    await this.#initialLoadPromise

    if (!this.isUnlocked) throw new Error('keystore: not unlocked')
    if (!this.#keystoreSeeds.length) throw new Error('keystore: no seed phrase added yet')

    const isTheSameHdPathTemplate = this.#keystoreSeeds[0].hdPathTemplate === nextHdPathTemplate
    if (isTheSameHdPathTemplate) return

    // As of v4.33.0 we support only one seed phrase (saved seed) to be added to the keystore
    this.#keystoreSeeds[0].hdPathTemplate = nextHdPathTemplate
    await this.#storage.set('keystoreSeeds', this.#keystoreSeeds)

    this.emitUpdate()
  }

  async #addKeysExternallyStored(keysToAdd: ExternalKey[]) {
    await this.#initialLoadPromise

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

    const keys = this.#keystoreKeys

    const newKeys = uniqueKeysToAdd
      .map(({ addr, type, label, dedicatedToOneSA, meta }) => ({
        addr,
        type,
        label,
        dedicatedToOneSA,
        meta,
        privKey: null
      }))
      // No need to re-add keys that are already added (with the same type / device)
      .filter(({ addr, type }) => !keys.some((x) => x.addr === addr && x.type === type))

    if (!newKeys.length) return

    const nextKeys = [...keys, ...newKeys]

    this.#keystoreKeys = nextKeys
    await this.#storage.set('keystoreKeys', nextKeys)
  }

  async addKeysExternallyStored(keysToAdd: ExternalKey[]) {
    await this.withStatus('addKeysExternallyStored', () => this.#addKeysExternallyStored(keysToAdd))
  }

  async #addKeys(keysToAdd: ReadyToAddKeys['internal']) {
    await this.#initialLoadPromise
    if (!keysToAdd.length) return
    if (this.#mainKey === null)
      throw new EmittableError({
        message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
        level: 'major',
        error: new Error('keystore: needs to be unlocked')
      })

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

    const keys = this.#keystoreKeys

    const newKeys: StoredKey[] = uniqueKeysToAdd
      .map(({ addr, type, label, privateKey, dedicatedToOneSA, meta }) => {
        // eslint-disable-next-line no-param-reassign
        privateKey = privateKey.substring(0, 2) === '0x' ? privateKey.substring(2) : privateKey

        // Set up the cipher
        const counter = new aes.Counter(this.#mainKey!.iv) // TS compiler fails to detect we check for null above
        const aesCtr = new aes.ModeOfOperation.ctr(this.#mainKey!.key, counter) // TS compiler fails to detect we check for null above

        return {
          addr,
          type,
          label,
          dedicatedToOneSA,
          privKey: hexlify(aesCtr.encrypt(aes.utils.hex.toBytes(privateKey))), // TODO: consider a MAC?
          meta
        }
      })
      // No need to re-add keys that are already added, private key never changes
      .filter(({ addr, type }) => !keys.some((x) => x.addr === addr && x.type === type))

    if (!newKeys.length) return

    const nextKeys = [...keys, ...newKeys]

    this.#keystoreKeys = nextKeys
    await this.#storage.set('keystoreKeys', nextKeys)
  }

  async addKeys(keysToAdd: ReadyToAddKeys['internal']) {
    await this.withStatus('addKeys', () => this.#addKeys(keysToAdd))
  }

  async removeKey(addr: Key['addr'], type: Key['type']) {
    await this.#initialLoadPromise
    if (!this.isUnlocked)
      throw new EmittableError({
        message:
          'Extension not unlocked. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('keystore: not unlocked')
      })
    const keys = this.#keystoreKeys
    if (!keys.find((x) => x.addr === addr && x.type === type))
      throw new EmittableError({
        message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
        level: 'major',
        error: new Error(
          `keystore: trying to remove key that does not exist: address: ${addr}, type: ${type}`
        )
      })

    this.#keystoreKeys = keys.filter((key) => {
      const isMatching = key.addr === addr && key.type === type

      return !isMatching
    })
    await this.#storage.set('keystoreKeys', this.#keystoreKeys)
  }

  async exportKeyWithPasscode(keyAddress: Key['addr'], keyType: Key['type'], passphrase: string) {
    await this.#initialLoadPromise
    if (this.#mainKey === null) throw new Error('keystore: needs to be unlocked')
    const keys = this.#keystoreKeys
    const storedKey = keys.find((x: StoredKey) => x.addr === keyAddress && x.type === keyType)

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

  async sendPrivateKeyToUi(keyAddress: string) {
    const decryptedPrivateKey = await this.#getPrivateKey(keyAddress)
    this.#windowManager.sendWindowUiMessage({ privateKey: `0x${decryptedPrivateKey}` })
  }

  async sendSeedToUi() {
    const decrypted = await this.getSavedSeed()
    this.#windowManager.sendWindowUiMessage({
      seed: decrypted.seed,
      seedPassphrase: decrypted.seedPassphrase
    })
  }

  async #getPrivateKey(keyAddress: string): Promise<string> {
    await this.#initialLoadPromise
    if (this.#mainKey === null) throw new Error('keystore: needs to be unlocked')
    const keys = this.#keystoreKeys

    const storedKey = keys.find((x: StoredKey) => x.addr === keyAddress)
    if (!storedKey) throw new Error('keystore: key not found')
    if (storedKey.type !== 'internal') throw new Error('keystore: key does not have privateKey')

    // decrypt the pk of keyAddress with the keystore's key
    const encryptedBytes = getBytes(storedKey.privKey as string)
    const counter = new aes.Counter(this.#mainKey.iv)
    const aesCtr = new aes.ModeOfOperation.ctr(this.#mainKey.key, counter)
    // encrypt the pk of keyAddress with publicKey
    const decryptedBytes = aesCtr.decrypt(encryptedBytes)
    return aes.utils.hex.fromBytes(decryptedBytes)
  }

  /**
   * Export with public key encrypt
   *
   * @param keyAddress string - the address of the key you want to export
   * @param publicKey string - the public key, with which to asymmetrically encrypt it (used for key sync with other device's keystoreId)
   * @returns Encrypted
   */
  async exportKeyWithPublicKeyEncryption(
    keyAddress: string,
    publicKey: string
  ): Promise<Encrypted> {
    const decryptedPrivateKey = await this.#getPrivateKey(keyAddress)
    const result = await encryptWithPublicKey(publicKey, decryptedPrivateKey)

    return result
  }

  async importKeyWithPublicKeyEncryption(encryptedSk: Encrypted, dedicatedToOneSA: boolean) {
    if (this.#mainKey === null) throw new Error('keystore: needs to be unlocked')
    const privateKey: string = await decryptWithPrivateKey(
      hexlify(getBytes(concat([this.#mainKey.key, this.#mainKey.iv]))),
      encryptedSk
    )
    if (!privateKey) throw new Error('keystore: wrong encryptedSk or private key')

    const keyToAdd: {
      addr: Key['addr']
      label: string
      type: 'internal'
      privateKey: string
      dedicatedToOneSA: Key['dedicatedToOneSA']
      meta: InternalKey['meta']
    } = {
      addr: new Wallet(privateKey).address,
      privateKey,
      label: getDefaultKeyLabel(this.keys, 0),
      type: 'internal',
      dedicatedToOneSA,
      meta: {
        createdAt: new Date().getTime()
      }
    }

    await this.addKeys([keyToAdd])
  }

  async getSigner(keyAddress: Key['addr'], keyType: Key['type']): Promise<KeystoreSignerInterface> {
    await this.#initialLoadPromise
    const keys = this.#keystoreKeys
    const storedKey = keys.find((x: StoredKey) => x.addr === keyAddress && x.type === keyType)

    if (!storedKey) throw new Error('keystore: key not found')
    const { addr, type, label, dedicatedToOneSA, meta } = storedKey

    const key = {
      addr,
      type,
      label,
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

  async getSavedSeed() {
    await this.#initialLoadPromise

    if (!this.isUnlocked) throw new Error('keystore: not unlocked')
    if (!this.#keystoreSeeds.length) throw new Error('keystore: no seed phrase added yet')

    const hdPathTemplate = this.#keystoreSeeds[0].hdPathTemplate
    const encryptedSeedBytes = getBytes(this.#keystoreSeeds[0].seed)
    // @ts-ignore
    const counter = new aes.Counter(this.#mainKey.iv)
    // @ts-ignore
    const aesCtr = new aes.ModeOfOperation.ctr(this.#mainKey.key, counter)
    const decryptedSeedBytes = aesCtr.decrypt(encryptedSeedBytes)
    const decryptedSeed = new TextDecoder().decode(decryptedSeedBytes)

    if (this.#keystoreSeeds[0].seedPassphrase) {
      const encryptedSeedPassphraseBytes = getBytes(this.#keystoreSeeds[0].seedPassphrase)
      const decryptedSeedPassphraseBytes = aesCtr.decrypt(encryptedSeedPassphraseBytes)
      const decryptedSeedPassphrase = new TextDecoder().decode(decryptedSeedPassphraseBytes)

      return {
        seed: decryptedSeed,
        seedPassphrase: decryptedSeedPassphrase,
        hdPathTemplate
      } as KeystoreSeed
    }

    return { seed: decryptedSeed, hdPathTemplate }
  }

  async #changeKeystorePassword(newSecret: string, oldSecret?: string, extraEntropy?: string) {
    await this.#initialLoadPromise

    // In the case the user wants to change their device password,
    // they should also provide the previous password (oldSecret).
    //
    // However, in the case of KeyStore recovery, the user may have already forgotten the password,
    // but the Keystore is already unlocked with the recovery secret.
    // Therefore, in the last case, we can't provide the oldSecret, and we should not validate it.
    //
    // However, there is one problem if we leave it that way:
    //
    //     1. If the user recovers and unlocks the Keystore.
    //     2. But doesn't enter a new 'password' in the recovery flow (just closes the tab).
    //     3. And later decides to change the old password from Settings.
    //     4. Then they would not be able to do it because they don't know the old password.
    //
    // We are going to discuss it in the next meeting, but for now, we are leaving it as it is.
    // The long-term solution would be to refactor EmailVault recovery logic
    // and not unlock the Keystore with the recovery secret unless the user provides a new passphrase.
    if (oldSecret) await this.#unlockWithSecret('password', oldSecret)

    if (!this.isUnlocked)
      throw new EmittableError({
        message: 'App not unlocked. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('keystore: not unlocked')
      })

    await this.#removeSecret('password')
    await this.#addSecret('password', newSecret, extraEntropy, true)
  }

  async changeKeystorePassword(newSecret: string, oldSecret?: string, extraEntropy?: string) {
    await this.withStatus('changeKeystorePassword', () =>
      this.#changeKeystorePassword(newSecret, oldSecret, extraEntropy)
    )
  }

  async updateKeyPreferences(
    keys: { addr: Key['addr']; type: Key['type']; preferences: KeyPreferences }[]
  ) {
    await this.withStatus('updateKeyPreferences', async () => this.#updateKeyPreferences(keys))
  }

  async #updateKeyPreferences(
    keys: { addr: Key['addr']; type: Key['type']; preferences: KeyPreferences }[]
  ) {
    this.#keystoreKeys = this.#keystoreKeys.map((keystoreKey) => {
      const key = keys.find((k) => k.addr === keystoreKey.addr && k.type === keystoreKey.type)

      if (!key) return keystoreKey

      return { ...keystoreKey, ...key.preferences }
    })
    await this.#storage.set('keystoreKeys', this.#keystoreKeys)
    this.emitUpdate()
  }

  async deleteSavedSeed() {
    await this.withStatus('deleteSavedSeed', () => this.#deleteSavedSeed())
  }

  async #deleteSavedSeed() {
    await this.#initialLoadPromise

    this.#keystoreSeeds = []
    await this.#storage.set('keystoreSeeds', this.#keystoreSeeds)

    this.emitUpdate()
  }

  resetErrorState() {
    this.errorMessage = ''
    this.emitUpdate()
  }

  get hasPasswordSecret() {
    return this.#keystoreSecrets.some((x) => x.id === 'password')
  }

  get hasKeystoreSavedSeed() {
    return !!this.#keystoreSeeds.length
  }

  get hasKeystoreTempSeed() {
    return !!this.#tempSeed
  }

  get banners(): Banner[] {
    if (!this.#tempSeed) return []

    return [
      {
        id: 'tempSeed',
        type: 'warning',
        category: 'temp-seed-not-confirmed',
        title: 'You have an unsaved imported seed',
        text: '',
        actions: [
          {
            label: 'Check',
            actionName: 'confirm-temp-seed'
          }
        ]
      }
    ]
  }

  getAccountKeys(acc: Account): Key[] {
    return this.keys.filter((key) => acc.associatedKeys.includes(key.addr))
  }

  getFeePayerKey(op: AccountOp): Key | Error {
    const feePayerKeys = this.keys.filter((key) => key.addr === op.gasFeePayment!.paidBy)
    const feePayerKey =
      // Temporarily prioritize the key with the same type as the signing key.
      // TODO: Implement a way to choose the key type to broadcast with.
      feePayerKeys.find((key) => key.type === op.signingKeyType) || feePayerKeys[0]

    if (!feePayerKey) {
      const missingKeyAddr = shortenAddress(op.gasFeePayment!.paidBy, 13)
      const accAddr = shortenAddress(op.accountAddr, 13)
      return new Error(
        `Key with address ${missingKeyAddr} for account with address ${accAddr} not found. 'Please try again or contact support if the problem persists.'`
      )
    }

    return feePayerKey
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      isUnlocked: this.isUnlocked, // includes the getter in the stringified instance
      keys: this.keys,
      hasPasswordSecret: this.hasPasswordSecret,
      hasKeystoreSavedSeed: this.hasKeystoreSavedSeed,
      hasKeystoreTempSeed: this.hasKeystoreTempSeed,
      banners: this.banners
    }
  }
}
