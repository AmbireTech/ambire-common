import aes from 'aes-js'
import {
  decryptWithPrivateKey,
  Encrypted,
  encryptWithPublicKey,
  publicKeyByPrivateKey
} from 'eth-crypto'
import { computeAddress, concat, getBytes, hexlify, keccak256, Mnemonic, Wallet } from 'ethers'

import {
  CIPHER,
  CIPHER_OLD,
  decryptWithKey,
  deriveSecret,
  encryptMainKeyWithSecret,
  encryptWithKey,
  extractEntropyFromSeed,
  getBytesForSecret,
  migrateStoredPayloadsToGCM,
  reconstructSeedFromEntropy,
  SCRYPT_PARAMS
} from '@/libs/keystore/keystore'

import EmittableError from '../../classes/EmittableError'
import {
  BIP44_STANDARD_DERIVATION_TEMPLATE,
  DERIVATION_OPTIONS,
  HD_PATH_TEMPLATE_TYPE
} from '../../consts/derivation'
import { Account } from '../../interfaces/account'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { KeyIterator } from '../../interfaces/keyIterator'
import {
  ExternalKey,
  IKeystoreController,
  InternalKey,
  Key,
  KeyPreferences,
  KeystoreSeed,
  KeystoreSignerInterface,
  KeystoreSignerType,
  KeystoreTempSeed,
  MainKey,
  MainKeyEncryptedWithSecret,
  MainKeyOld,
  ReadyToAddKeys,
  StoredKey,
  StoredKeystoreSeed
} from '../../interfaces/keystore'
import { Platform } from '../../interfaces/platform'
import { IStorageController } from '../../interfaces/storage'
import { IUiController } from '../../interfaces/ui'
import { EntropyGenerator } from '../../libs/entropyGenerator/entropyGenerator'
import { getDefaultKeyLabel } from '../../libs/keys/keys'
import { ScryptAdapter } from '../../libs/scrypt/scryptAdapter'
import shortenAddress from '../../utils/shortenAddress'
import { generateUuid } from '../../utils/uuid'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'

const KEYSTORE_UNEXPECTED_ERROR_MESSAGE =
  'Keystore unexpected error. If the problem persists, please contact support.'

export const STATUS_WRAPPED_METHODS = {
  unlockWithSecret: 'INITIAL',
  addSecret: 'INITIAL',
  addSeed: 'INITIAL',
  updateSeed: 'INITIAL',
  deleteSeed: 'INITIAL',
  removeSecret: 'INITIAL',
  addKeys: 'INITIAL',
  addKeysExternallyStored: 'INITIAL',
  changeKeystorePassword: 'INITIAL',
  updateKeyPreferences: 'INITIAL'
} as const

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
export class KeystoreController extends EventEmitter implements IKeystoreController {
  #mainKey: MainKey | null

  // Secrets are strings that are used to encrypt the mainKey.
  // The mainKey could be encrypted with many secrets.
  #keystoreSecrets: MainKeyEncryptedWithSecret[] = []

  #storage: IStorageController

  #keystoreSeeds: StoredKeystoreSeed[] = []

  #tempSeed: KeystoreTempSeed | null = null

  #keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>

  #keystoreKeys: StoredKey[] = []

  #internalKeysToAddOnKeystoreReady: ReadyToAddKeys['internal'] = []

  #externalKeysToAddOnKeystoreReady: ReadyToAddKeys['external'] = []

  keyStoreUid: string | null

  #isReadyToStoreKeys: boolean = false

  errorMessage: string = ''

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  #ui: IUiController

  #scryptAdapter: ScryptAdapter

  constructor(
    platform: Platform,
    _storage: IStorageController,
    _keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>,
    ui: IUiController,
    eventEmitterRegistry?: IEventEmitterRegistryController
  ) {
    super(eventEmitterRegistry)
    this.#storage = _storage
    this.#keystoreSigners = _keystoreSigners
    this.#mainKey = null
    this.keyStoreUid = null
    this.#ui = ui
    this.#scryptAdapter = new ScryptAdapter(platform)
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    try {
      const [keystoreSeeds, keyStoreUid, keystoreKeys] = await Promise.all([
        this.#storage.get('keystoreSeeds', []),
        this.#storage.get('keyStoreUid', null),
        this.#storage.get('keystoreKeys', [])
      ])
      this.keyStoreUid = keyStoreUid
      this.#keystoreSeeds = keystoreSeeds.map((s) => {
        if (s.id) return s

        // Migrate the old seed structure to the new one for cases where the prev versions
        // of the extension supported only one saved seed which lacked id and label props.
        return { ...s, id: 'legacy-saved-seed', label: 'Recovery Phrase 1' }
      })
      this.#keystoreKeys = keystoreKeys
    } catch (e: any) {
      this.emitError({
        message:
          'Something went wrong when loading the Keystore. Please try again or contact support if the problem persists.',
        level: 'major',
        error: e
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

  get hasTempSeed() {
    return !!this.#tempSeed
  }

  get isReadyToStoreKeys() {
    return this.#isReadyToStoreKeys
  }

  set isReadyToStoreKeys(val) {
    this.#isReadyToStoreKeys = val

    if (val && this.#internalKeysToAddOnKeystoreReady.length) {
      void this.#addKeys(this.#internalKeysToAddOnKeystoreReady)
    }
    if (val && this.#externalKeysToAddOnKeystoreReady.length) {
      void this.#addKeysExternallyStored(this.#externalKeysToAddOnKeystoreReady)
    }
  }

  async getKeyStoreUid() {
    const uid = this.keyStoreUid
    if (!uid) throw new Error('keystore: adding secret before get uid')

    return uid
  }

  // @TODO time before unlocking
  async #unlockWithSecret(secretId: string, secret: string) {
    await this.initialLoadPromise

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
    if (
      aesEncrypted.cipherType !== CIPHER &&
      aesEncrypted.cipherType !== CIPHER_OLD &&
      aesEncrypted.cipherType !== undefined
    ) {
      throw new EmittableError({
        message:
          'Something went wrong when trying to unlock Ambire. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error(`keystore: unsupported cipherType ${aesEncrypted.cipherType}`)
      })
    }

    const secretKey = await deriveSecret(this.#scryptAdapter, secret, scryptParams.salt)
    const isOldSecretCipher =
      aesEncrypted.cipherType === undefined || aesEncrypted.cipherType === CIPHER_OLD

    if (isOldSecretCipher) {
      // 1. Retrieve the main key using the old encryption method
      const mainKeyOld = this.#unlockWithSecretOld(secretKey, secretEntry)

      // Rebuild the new main key from the old one.
      // `mainKeyOld` is the previous 128-bit key (16 bytes), while the new encryption scheme
      // needs a 256-bit main key (32 bytes).
      // We cannot generate a new random key here, because the user may have more than one secret
      // and we need to be able to recreate the same main key again if another secret is migrated later.
      //
      // We simply concatenate `mainKeyOld.key` and `mainKeyOld.iv` (16 bytes each, 32 bytes total).
      this.#mainKey = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(getBytes(concat([mainKeyOld.key, mainKeyOld.iv]))),
        { name: CIPHER },
        true,
        ['encrypt', 'decrypt']
      )

      // 3. Migrate the secret and all stored seeds/pks to use GCM, then persist everything
      // together once both migrations have completed.
      try {
        const migratedSecrets = await this.#migrateSecretToGCM(secretEntry.id, secretKey)
        const { migratedKeys, migratedSeeds, hasMigrated } =
          await this.#migrateStoredPayloadsToGCMIfNeeded()

        await this.#persistMigratedKeystoreData({
          secrets: migratedSecrets,
          keys: hasMigrated ? migratedKeys : undefined,
          seeds: hasMigrated ? migratedSeeds : undefined
        })
      } catch (e) {
        this.emitError({
          message: 'Keystore migration to GCM failed.',
          level: 'silent',
          error: e instanceof Error ? e : new Error('keystore: GCM migration failed')
        })
      }
    } else {
      await this.#unlockWithSecretGCM(secretKey, secretEntry)

      // The secret is already on GCM, but stored keys/seeds may still be on AES-CTR if a previous
      // migration was interrupted or partially failed. Retry here so the migration eventually
      // completes; it's a no-op when there is nothing left to migrate.
      try {
        const { migratedKeys, migratedSeeds, hasMigrated } =
          await this.#migrateStoredPayloadsToGCMIfNeeded()

        if (hasMigrated) {
          await this.#persistMigratedKeystoreData({ keys: migratedKeys, seeds: migratedSeeds })
        }
      } catch (e) {
        this.emitError({
          message: 'Keystore migration to GCM failed.',
          level: 'silent',
          error: e instanceof Error ? e : new Error('keystore: GCM migration failed')
        })
      }
    }
  }

  /**
   * Used only once to decrypt the main key with AES-CTR, in order to migrate the secrets and stored keys/seeds to AES-GCM.
   */
  #unlockWithSecretOld(secretKey: Uint8Array, secretEntry: MainKeyEncryptedWithSecret): MainKeyOld {
    const aesEncrypted = secretEntry.aesEncrypted
    if (aesEncrypted.cipherType !== undefined && aesEncrypted.cipherType !== CIPHER_OLD) {
      throw new Error('keystore: invalid old secret cipher type')
    }

    const iv = getBytes(aesEncrypted.iv)
    const derivedKey = secretKey.slice(0, 16)
    const macPrefix = secretKey.slice(16, 32)
    const counter = new aes.Counter(iv)
    const aesCtr = new aes.ModeOfOperation.ctr(derivedKey, counter)
    const mac = keccak256(concat([macPrefix, aesEncrypted.ciphertext]))

    if ('mac' in aesEncrypted && mac !== aesEncrypted.mac) {
      this.errorMessage = 'Incorrect password. Please try again.'
      this.emitUpdate()

      const error = new Error(this.errorMessage)
      throw new EmittableError({
        level: 'silent',
        message: this.errorMessage,
        error,
        sendCrashReport: false
      })
    }
    this.errorMessage = ''

    const decrypted = aesCtr.decrypt(getBytes(aesEncrypted.ciphertext))

    return {
      key: decrypted.slice(0, 16),
      iv: decrypted.slice(16, 32)
    }
  }

  /**
   * Used for all unlocks, unless the user hasn't unlocked and migrated the keystore since the AES-GCM migration was implemented.
   */
  async #unlockWithSecretGCM(
    secretKey: Uint8Array<ArrayBuffer>,
    secretEntry: MainKeyEncryptedWithSecret
  ) {
    if (secretEntry.aesEncrypted.cipherType !== CIPHER) {
      throw new Error('keystore: invalid gcm secret cipher type')
    }

    const keyFromSecret = await crypto.subtle.importKey(
      'raw',
      // use 256 bits (first 32 bytes)
      secretKey.slice(0, 32),
      { name: CIPHER },
      false,
      ['encrypt', 'decrypt']
    )

    let decrypted: ArrayBuffer
    try {
      decrypted = await crypto.subtle.decrypt(
        {
          name: CIPHER,
          iv: new Uint8Array(getBytes(secretEntry.aesEncrypted.iv)),
          tagLength: 128
        },
        keyFromSecret,
        new Uint8Array(getBytes(secretEntry.aesEncrypted.ciphertext))
      )
    } catch (error: any) {
      // Either wrong password or corrupted/tampered ciphertext
      if (error?.name === 'OperationError') {
        this.errorMessage = 'Incorrect password. Please try again.'
        this.emitUpdate()

        throw new EmittableError({
          level: 'silent',
          message: this.errorMessage,
          error: new Error(this.errorMessage),
          sendCrashReport: false
        })
      }

      // Anything else is unexpected so we should report to Sentry
      throw new EmittableError({
        level: 'major',
        message:
          'Something went wrong when trying to unlock. Please try again or contact support if the problem persists.',
        error:
          error instanceof Error ? error : new Error('keystore: unexpected error during GCM unlock')
      })
    }

    this.#mainKey = await crypto.subtle.importKey(
      'raw',
      decrypted.slice(0, 32),
      { name: CIPHER },
      true,
      ['encrypt', 'decrypt']
    )

    this.errorMessage = ''
  }

  async #findStoredSeed(seed: string, seedPassphrase?: string | null) {
    const normalizedSeed = Mnemonic.fromPhrase(seed).phrase
    const normalizedPassphrase = seedPassphrase || ''

    for (const storedSeed of this.#keystoreSeeds) {
      const decryptedStoredSeed = await this.getSavedSeed(storedSeed.id)
      if (decryptedStoredSeed.seed !== normalizedSeed) continue
      if ((decryptedStoredSeed.seedPassphrase || '') !== normalizedPassphrase) continue

      return storedSeed
    }

    return null
  }

  /**
   * Used to migrate a specific secret to GCM. Secrets have to be migrated separately, because
   * they are encrypted with unique secrets, which we need from the user in order to be able to migrate them.
   *
   * At this point we have already validated that the provided secret is correct and we have the main key
   * decrypted in memory, so we just need to re-encrypt it with GCM using the secret
   */
  async #migrateSecretToGCM(
    secretId: string,
    secretKey: Uint8Array<ArrayBuffer>
  ): Promise<MainKeyEncryptedWithSecret[]> {
    return Promise.all(
      this.#keystoreSecrets.map(async (secret) => {
        if (secret.id !== secretId) return secret

        const encrypted = await encryptMainKeyWithSecret(this.#mainKey!, secretKey)

        return {
          ...secret,
          aesEncrypted: encrypted
        }
      })
    )
  }

  /**
   * Re-encrypts all AES-CTR stored keys and seeds to AES-GCM. It does not persist anything itself,
   * so the caller can persist the result together with the migrated secret in a single step.
   * `hasMigrated` indicates whether anything was actually re-encrypted, so the caller can skip
   * persisting (and avoid pointless storage writes) when there was nothing left to migrate.
   */
  async #migrateStoredPayloadsToGCMIfNeeded(): Promise<{
    migratedKeys: StoredKey[]
    migratedSeeds: StoredKeystoreSeed[]
    hasMigrated: boolean
  }> {
    if (!this.#mainKey) throw new Error('keystore: needs to be unlocked')

    const { migratedKeys, migratedSeeds, failedMigrations, hasMigrated } =
      await migrateStoredPayloadsToGCM(this.#mainKey, this.#keystoreKeys, this.#keystoreSeeds)

    if (failedMigrations.keyAddrs.length || failedMigrations.seedIds.length) {
      this.emitError({
        message: `Failed to migrate ${failedMigrations.keyAddrs.length} keys and ${failedMigrations.seedIds.length} seeds to AES-GCM encryption.`,
        level: 'silent',
        error: new Error(
          `keystore: failed to migrate ${failedMigrations.keyAddrs.length} keys and ${failedMigrations.seedIds.length} seeds to AES-GCM encryption`
        )
      })
    }

    return { migratedKeys, migratedSeeds, hasMigrated }
  }

  /**
   * Persists the migrated keystore data and updates the in-memory state in one place.
   * Only the provided slices are written, so callers persist exactly what they migrated.
   */
  async #persistMigratedKeystoreData({
    secrets,
    keys,
    seeds
  }: {
    secrets?: MainKeyEncryptedWithSecret[]
    keys?: StoredKey[]
    seeds?: StoredKeystoreSeed[]
  }) {
    if (secrets) {
      await this.#storage.set('keystoreSecrets', secrets)
      this.#keystoreSecrets = secrets
    }

    if (keys) {
      await this.#storage.set('keystoreKeys', keys)
      this.#keystoreKeys = keys
    }

    if (seeds) {
      await this.#storage.set('keystoreSeeds', seeds)
      this.#keystoreSeeds = seeds
    }
  }

  async unlockWithSecret(secretId: string, secret: string) {
    await this.withStatus('unlockWithSecret', () => this.#unlockWithSecret(secretId, secret), true)
  }

  async #addSecret(
    secretId: string,
    secret: string,
    extraEntropy: string = '',
    leaveUnlocked: boolean = false
  ) {
    await this.initialLoadPromise

    // @TODO test
    if (this.#keystoreSecrets.find((x) => x.id === secretId))
      throw new EmittableError({
        message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
        level: 'major',
        error: new Error(`keystore: trying to add duplicate secret ${secretId}`)
      })

    let mainKey: MainKey | null = this.#mainKey

    // We are not unlocked
    if (!mainKey) {
      if (!this.#keystoreSecrets.length) {
        // Generate a new main key if this is the first secret being added
        const generatedMainKey = new EntropyGenerator().generateRandomBytes(32, extraEntropy)
        mainKey = await crypto.subtle.importKey(
          'raw',
          new Uint8Array(generatedMainKey),
          { name: CIPHER, length: 256 },
          true,
          ['encrypt', 'decrypt']
        )
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

    const entropyGenerator = new EntropyGenerator()
    const salt = entropyGenerator.generateRandomBytes(32, extraEntropy)
    const secretKey = await deriveSecret(this.#scryptAdapter, secret, hexlify(salt))
    const mainKeyEncryptedWithSecret = await encryptMainKeyWithSecret(mainKey, secretKey)

    this.#keystoreSecrets.push({
      id: secretId,
      scryptParams: { salt: hexlify(salt), ...SCRYPT_PARAMS },
      aesEncrypted: mainKeyEncryptedWithSecret
    })

    // Persist the new secrets
    await this.#storage.set('keystoreSecrets', this.#keystoreSecrets)

    // produce uid if one doesn't exist (should be created when the first secret is added)
    if (!this.keyStoreUid) {
      const exportedMainKeyUint8Array = new Uint8Array(
        await crypto.subtle.exportKey('raw', mainKey!)
      )
      const privateKeyHex = hexlify(exportedMainKeyUint8Array)
      const uid = publicKeyByPrivateKey(privateKeyHex)
      this.keyStoreUid = uid
      await this.#storage.set('keyStoreUid', uid)
    }

    this.isReadyToStoreKeys = true
  }

  async addSecret(secretId: string, secret: string, extraEntropy: string, leaveUnlocked: boolean) {
    await this.withStatus(
      'addSecret',
      () => this.#addSecret(secretId, secret, extraEntropy, leaveUnlocked),
      true
    )
  }

  async #removeSecret(secretId: string) {
    await this.initialLoadPromise

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

  get seeds() {
    return this.#keystoreSeeds.map(({ id, label, hdPathTemplate, seedPassphrase }) => ({
      id,
      label: label || 'Unnamed Recovery Seed',
      hdPathTemplate,
      withPassphrase: !!seedPassphrase
    }))
  }

  async addTempSeed({ seed, seedPassphrase, hdPathTemplate }: KeystoreTempSeed) {
    const validHdPath = DERIVATION_OPTIONS.some((o) => o.value === hdPathTemplate)
    if (!validHdPath)
      throw new EmittableError({
        message:
          'Incorrect derivation path when trying to update the temp seed. Please contact support',
        level: 'major',
        error: new Error('keystore: hd path to temp seed incorrect')
      })

    this.#tempSeed = { seed, seedPassphrase, hdPathTemplate }

    this.emitUpdate()
  }

  async generateTempSeed({ extraEntropy }: { extraEntropy?: string }) {
    const entropyGenerator = new EntropyGenerator()
    const seed = entropyGenerator.generateRandomMnemonic(12, extraEntropy || '').phrase

    this.#tempSeed = { seed, hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE }

    this.emitUpdate()
  }

  deleteTempSeed(shouldUpdate = true) {
    this.#tempSeed = null
    if (shouldUpdate) this.emitUpdate()
  }

  async persistTempSeed() {
    if (!this.#tempSeed) return undefined

    const persistedSeed = await this.#addSeed(this.#tempSeed)
    this.#tempSeed = null
    this.emitUpdate()

    return persistedSeed
  }

  async #addSeed({ seed, seedPassphrase, hdPathTemplate }: KeystoreTempSeed) {
    await this.initialLoadPromise

    if (this.#mainKey === null)
      throw new EmittableError({
        message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
        level: 'major',
        error: new Error('keystore: needs to be unlocked')
      })

    if (!Mnemonic.isValidMnemonic(seed)) {
      throw new EmittableError({
        message:
          'The provided seed phrase is invalid. Try again with a valid seed or contact support if you think this is a mistake.',
        level: 'expected',
        error: new Error('keystore: trying to add an invalid seed phrase')
      })
    }

    const existingEntry = await this.#findStoredSeed(seed, seedPassphrase)
    if (existingEntry)
      return {
        id: existingEntry.id,
        label: existingEntry.label,
        hdPathTemplate: existingEntry.hdPathTemplate,
        withPassphrase: !!existingEntry.seedPassphrase
      }

    const entropy = extractEntropyFromSeed(seed)

    const label = `Recovery Phrase ${this.#keystoreSeeds.length + 1}`

    const newEntry: StoredKeystoreSeed = {
      id: generateUuid(),
      label,
      seed: await encryptWithKey(this.#mainKey, entropy),
      seedPassphrase: seedPassphrase
        ? await encryptWithKey(this.#mainKey, new TextEncoder().encode(seedPassphrase))
        : null,
      hdPathTemplate
    }

    this.#keystoreSeeds.push(newEntry)

    await this.#storage.set('keystoreSeeds', this.#keystoreSeeds)

    this.emitUpdate()

    return {
      id: newEntry.id,
      label: newEntry.label,
      hdPathTemplate: newEntry.hdPathTemplate,
      withPassphrase: !!newEntry.seedPassphrase
    }
  }

  async addSeed(keystoreSeed: KeystoreTempSeed) {
    await this.withStatus('addSeed', () => this.#addSeed(keystoreSeed), true)
  }

  async #updateSeed({
    id,
    label,
    hdPathTemplate
  }: {
    id: KeystoreSeed['id']
    label?: KeystoreSeed['label']
    hdPathTemplate?: KeystoreSeed['hdPathTemplate']
  }) {
    if (!label && !hdPathTemplate) return

    const keystoreSeed = this.#keystoreSeeds.find((s) => s.id === id)
    if (!keystoreSeed) return

    if (label) keystoreSeed.label = label

    if (hdPathTemplate) keystoreSeed.hdPathTemplate = hdPathTemplate

    const updatedKeystoreSeeds = this.#keystoreSeeds.map((s) =>
      s.id === keystoreSeed.id ? keystoreSeed : s
    )

    this.#keystoreSeeds = updatedKeystoreSeeds
    await this.#storage.set('keystoreSeeds', this.#keystoreSeeds)

    this.emitUpdate()
  }

  async updateSeed({
    id,
    label,
    hdPathTemplate
  }: {
    id: KeystoreSeed['id']
    label?: KeystoreSeed['label']
    hdPathTemplate?: KeystoreSeed['hdPathTemplate']
  }) {
    await this.withStatus('updateSeed', () => this.#updateSeed({ id, label, hdPathTemplate }), true)
  }

  async deleteSeed(id: KeystoreSeed['id']) {
    await this.withStatus('deleteSeed', () => this.#deleteSeed(id))
  }

  async #deleteSeed(id: KeystoreSeed['id']) {
    await this.initialLoadPromise

    this.#keystoreSeeds = this.#keystoreSeeds.filter((s) => s.id !== id)
    await this.#storage.set('keystoreSeeds', this.#keystoreSeeds)

    this.emitUpdate()
  }

  async changeTempSeedHdPathTemplateIfNeeded(nextHdPathTemplate?: HD_PATH_TEMPLATE_TYPE) {
    if (!nextHdPathTemplate) return // should never happen

    await this.initialLoadPromise

    if (!this.isUnlocked) throw new Error('keystore: not unlocked')
    if (!this.#tempSeed) throw new Error('keystore: no temp seed at the moment')

    const isTheSameHdPathTemplate = this.#tempSeed.hdPathTemplate === nextHdPathTemplate
    if (isTheSameHdPathTemplate) return

    this.#tempSeed.hdPathTemplate = nextHdPathTemplate

    this.emitUpdate()
  }

  async #addKeysExternallyStored(keysToAdd: ExternalKey[]) {
    await this.initialLoadPromise

    if (!keysToAdd.length) return

    if (!this.isReadyToStoreKeys) {
      this.#externalKeysToAddOnKeystoreReady = [
        ...this.#externalKeysToAddOnKeystoreReady,
        ...keysToAdd
      ]

      return
    }

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
    await this.withStatus(
      'addKeysExternallyStored',
      () => this.#addKeysExternallyStored(keysToAdd),
      true
    )
  }

  async #addKeys(keysToAdd: ReadyToAddKeys['internal']) {
    await this.initialLoadPromise
    if (!keysToAdd.length) return
    if (!this.isReadyToStoreKeys) {
      this.#internalKeysToAddOnKeystoreReady = [
        ...this.#internalKeysToAddOnKeystoreReady,
        ...keysToAdd
      ]
      return
    }

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

    const newKeys: StoredKey[] = (
      await Promise.all(
        uniqueKeysToAdd.map(async ({ addr, type, label, privateKey, dedicatedToOneSA, meta }) => {
          privateKey = privateKey.substring(0, 2) === '0x' ? privateKey.substring(2) : privateKey

          // Set up the cipher
          return {
            addr,
            type,
            label,
            dedicatedToOneSA,
            privKey: await encryptWithKey(this.#mainKey!, aes.utils.hex.toBytes(privateKey)),
            meta
          }
        })
      )
    )
      // No need to re-add keys that are already added, private key never changes
      .filter(({ addr, type }) => !keys.some((x) => x.addr === addr && x.type === type))

    if (!newKeys.length) return

    const nextKeys = [...keys, ...newKeys]

    this.#keystoreKeys = nextKeys
    await this.#storage.set('keystoreKeys', nextKeys)
  }

  async addKeys(keysToAdd: ReadyToAddKeys['internal']) {
    await this.withStatus('addKeys', () => this.#addKeys(keysToAdd), true)
  }

  async removeKey(addr: Key['addr'], type: Key['type']) {
    await this.initialLoadPromise
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
    await this.initialLoadPromise
    if (this.#mainKey === null) throw new Error('keystore: needs to be unlocked')
    const keys = this.#keystoreKeys
    const storedKey = keys.find((x: StoredKey) => x.addr === keyAddress && x.type === keyType)

    if (!storedKey) throw new Error('keystore: key not found')
    if (storedKey.type !== 'internal') throw new Error('keystore: key does not have privateKey')

    const decryptedBytes = await decryptWithKey(this.#mainKey, storedKey.privKey)
    const decryptedPrivateKey = hexlify(decryptedBytes)
    const wallet = new Wallet(decryptedPrivateKey)
    const keyBackup = await wallet.encrypt(passphrase)
    return JSON.stringify(keyBackup)
  }

  async sendPrivateKeyToUi(keyAddress: string) {
    const decryptedPrivateKey = await this.#getPrivateKey(keyAddress)
    this.#ui.message.sendUiMessage({ privateKey: `0x${decryptedPrivateKey}` })
  }

  /**
   * Decrypt the private key encrypted with the main key,
   * encrypt it with a new salt and entropy to not leak the
   * main key's ones, and send it over with the salt and entropy
   * to the UI
   */
  async sendPasswordEncryptedPrivateKeyToUi(keyAddress: string, secret: string, entropy: string) {
    const decryptedPrivateKey = await this.#getPrivateKey(keyAddress)

    const entropyGenerator = new EntropyGenerator()
    const salt = entropyGenerator.generateRandomBytes(32, entropy)
    await wait(0) // a trick to prevent UI freeze while the CPU is busy
    const key = await this.#scryptAdapter.scrypt(getBytesForSecret(secret), salt, SCRYPT_PARAMS)
    await wait(0)
    const iv = entropyGenerator.generateRandomBytes(16, entropy)
    const derivedKey = key.slice(0, 16)
    const counter = new aes.Counter(iv)
    const aesCtr = new aes.ModeOfOperation.ctr(derivedKey, counter)
    const privateKey = aesCtr.encrypt(getBytes(`0x${decryptedPrivateKey}`))

    this.#ui.message.sendUiMessage({
      privateKey: hexlify(privateKey),
      salt: hexlify(salt),
      iv: hexlify(iv)
    })
  }

  /**
   * Decrypts an imported private key using the provided password (secret, salt, iv),
   * validates the decrypted key against the associated keys,
   * and sends the result to the UI.
   */
  async sendPasswordDecryptedPrivateKeyToUi(
    secret: string,
    key: string,
    salt: string,
    iv: string,
    associatedKeys: string[]
  ) {
    await this.initialLoadPromise
    const counter = new aes.Counter(getBytes(iv))
    const decryptKey = await this.#scryptAdapter.scrypt(
      getBytesForSecret(secret),
      getBytes(salt),
      SCRYPT_PARAMS
    )
    const derivedKey = decryptKey.slice(0, 16)
    const aesCtr = new aes.ModeOfOperation.ctr(derivedKey, counter)
    const decryptedBytes = aesCtr.decrypt(getBytes(key))
    const privateKey = `0x${aes.utils.hex.fromBytes(decryptedBytes)}`
    const addr = computeAddress(privateKey)

    if (!associatedKeys.includes(addr)) {
      this.errorMessage = 'Incorrect password. Please try again.'
      this.emitUpdate()
      return
    }

    this.#ui.message.sendUiMessage({ privateKey })
  }

  async sendSeedToUi(id: string) {
    const decrypted = await this.getSavedSeed(id)
    this.#ui.message.sendUiMessage({
      seed: decrypted.seed,
      seedPassphrase: decrypted.seedPassphrase
    })
  }

  async sendTempSeedToUi() {
    if (!this.#tempSeed) return

    this.#ui.message.sendUiMessage({ tempSeed: this.#tempSeed })
  }

  async #getPrivateKey(keyAddress: string): Promise<string> {
    await this.initialLoadPromise
    if (this.#mainKey === null) throw new Error('keystore: needs to be unlocked')
    const keys = this.#keystoreKeys

    const storedKey = keys.find((x: StoredKey) => x.addr === keyAddress && x.type === 'internal')
    if (!storedKey || storedKey.type !== 'internal' || !storedKey.privKey)
      throw new Error('keystore: key not found')

    const decryptedBytes = await decryptWithKey(this.#mainKey, storedKey.privKey)
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

    const exportedKey = await crypto.subtle.exportKey('raw', this.#mainKey)
    const privateKeyHex = hexlify(new Uint8Array(exportedKey))

    const privateKey: string = await decryptWithPrivateKey(privateKeyHex, encryptedSk)
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
    await this.initialLoadPromise
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
      if (!this.isUnlocked || !this.#mainKey) throw new Error('keystore: not unlocked')
      if (storedKey.type !== 'internal' || !storedKey.privKey)
        throw new Error('keystore: key does not have privateKey')

      const decryptedBytes = await decryptWithKey(this.#mainKey, storedKey.privKey)
      const decryptedPrivateKey = aes.utils.hex.fromBytes(decryptedBytes)

      // @ts-expect-error TODO: Figure out the correct type definition
      return new SignerInitializer(key, decryptedPrivateKey)
    }

    // @ts-expect-error TODO: Figure out the correct type definition
    return new SignerInitializer(key)
  }

  async getSavedSeed(id: string): Promise<KeystoreSeed> {
    await this.initialLoadPromise

    if (!this.isUnlocked || !this.#mainKey) throw new Error('keystore: not unlocked')
    if (!this.#keystoreSeeds.length) throw new Error('keystore: no seed phrase added yet')

    const keystoreSeed = this.#keystoreSeeds.find((s) => s.id === id)

    if (!keystoreSeed) throw new Error(`keystore seed with id:${id} not found`)

    const seedBytes = await decryptWithKey(this.#mainKey, keystoreSeed.seed)
    let seedPassphrase: string | null = null

    if (keystoreSeed.seedPassphrase) {
      const decryptedSeedPassphraseBytes = await decryptWithKey(
        this.#mainKey,
        keystoreSeed.seedPassphrase
      )

      seedPassphrase = new TextDecoder().decode(decryptedSeedPassphraseBytes)
      if (seedPassphrase === '') seedPassphrase = null
    }

    // Decrypt as encoded text first, even if it's entropy
    let decryptedSeed = new TextDecoder().decode(seedBytes)

    // Seeds after the GCM migration are stored as entropy bytes, so we have to
    // reconstruct the seed from that
    if (typeof keystoreSeed.seed !== 'string') {
      decryptedSeed = reconstructSeedFromEntropy(seedBytes, seedPassphrase)
    } else if (!Mnemonic.isValidMnemonic(decryptedSeed)) {
      throw new Error('keystore: invalid seed stored')
    }

    return {
      ...keystoreSeed,
      seed: decryptedSeed,
      seedPassphrase: seedPassphrase
    }
  }

  async #changeKeystorePassword(newSecret: string, oldSecret?: string, extraEntropy?: string) {
    await this.initialLoadPromise

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

  resetErrorState() {
    this.errorMessage = ''
    this.emitUpdate()
  }

  get hasPasswordSecret() {
    return this.#keystoreSecrets.some((x) => x.id === 'password')
  }

  get hasBiometricsSecret() {
    return this.#keystoreSecrets.some((x) => x.id === 'biometrics')
  }

  get hasKeystoreTempSeed() {
    return !!this.#tempSeed
  }

  getAccountKeys(acc: Account): Key[] {
    return this.keys.filter((key) => acc.associatedKeys.includes(key.addr))
  }

  getFeePayerKey(
    accountAddr: Account['addr'],
    paidByKeyAddr: Key['addr'],
    paidByKeyType?: Key['type']
  ): Key | Error {
    const feePayerKeys = this.keys.filter((key) => key.addr === paidByKeyAddr)
    let feePayerKey = feePayerKeys[0]

    if (paidByKeyType) {
      feePayerKey = feePayerKeys.find((key) => key.type === paidByKeyType) || feePayerKey
    }

    if (!feePayerKey) {
      const missingKeyAddr = shortenAddress(paidByKeyAddr, 13)
      const accAddr = shortenAddress(accountAddr, 13)
      return new Error(
        `Key with address ${missingKeyAddr} for account with address ${accAddr} not found. 'Please try again or contact support if the problem persists.'`
      )
    }

    return feePayerKey
  }

  isKeyIteratorInitializedWithTempSeed(keyIterator?: KeyIterator | null) {
    if (!this.#tempSeed || !keyIterator || keyIterator.subType !== 'seed') return false

    return (
      !!keyIterator.isSeedMatching &&
      keyIterator.isSeedMatching(this.#tempSeed.seed, this.#tempSeed.seedPassphrase ?? null)
    )
  }

  async getKeystoreSeed(keyIterator?: KeyIterator | null): Promise<StoredKeystoreSeed | null> {
    if (!keyIterator || keyIterator.subType !== 'seed' || !keyIterator.isSeedMatching) return null

    for (const storedSeed of this.#keystoreSeeds) {
      const decryptedStoredSeed = await this.getSavedSeed(storedSeed.id)

      if (
        !keyIterator.isSeedMatching(
          decryptedStoredSeed.seed,
          decryptedStoredSeed.seedPassphrase ?? null
        )
      )
        continue

      return storedSeed
    }

    return null
  }

  async updateKeystoreKeys() {
    const keystoreKeys = await this.#storage.get('keystoreKeys', [])
    this.#keystoreKeys = keystoreKeys

    this.emitUpdate()
  }

  decryptMessage = async ({
    encryptedMessage,
    keyAddr,
    keyType
  }: {
    encryptedMessage: string
    keyAddr: Key['addr']
    keyType: Key['type']
  }) => {
    const signer = await this.getSigner(keyAddr, keyType)
    if (!signer.decrypt)
      throw new Error(
        `This account uses a key type (${keyType}) that does not support getting encryption public key.`
      )

    try {
      return signer.decrypt(encryptedMessage)
    } catch (e) {
      const message = `Failed to decrypt message. Error details: <${e}>`
      throw new EmittableError({ message, level: 'major', error: new Error(`keystore: ${e}`) })
    }
  }

  sendDecryptedMessageToUi = async ({
    encryptedMessage,
    keyAddr,
    keyType
  }: {
    encryptedMessage: string
    keyAddr: Key['addr']
    keyType: Key['type']
  }) => {
    const decryptedMessage = await this.decryptMessage({
      encryptedMessage,
      keyAddr,
      keyType
    })

    this.#ui.message.sendUiMessage({ decryptedMessage })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      // includes the getters in the stringified instance
      isUnlocked: this.isUnlocked,
      keys: this.keys,
      seeds: this.seeds,
      hasPasswordSecret: this.hasPasswordSecret,
      hasBiometricsSecret: this.hasBiometricsSecret,
      hasKeystoreTempSeed: this.hasKeystoreTempSeed,
      hasTempSeed: this.hasTempSeed,
      isReadyToStoreKeys: this.isReadyToStoreKeys
    }
  }
}
