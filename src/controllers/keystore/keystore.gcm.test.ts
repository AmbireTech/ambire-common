import aes from 'aes-js'
import { concat, getBytes, hexlify, keccak256, toUtf8Bytes, Wallet } from 'ethers'
import { verifyMessage } from 'viem'

import { EntropyGenerator } from '@/libs/entropyGenerator/entropyGenerator'
import * as keystoreLib from '@/libs/keystore/keystore'
import { KeystoreSigner } from '@/libs/keystoreSigner/keystoreSigner'
import { ScryptAdapter } from '@/libs/scrypt/scryptAdapter'
import wait from '@/utils/wait'
import { describe, expect } from '@jest/globals'
import { CTR_STORAGE, LedgerSigner } from '@test/keystore'

import {
  ACCOUNTS_SYNC_PAYLOAD_VERSION,
  AccountsSyncPayload,
  parseAccountsSyncPayload,
  serializeAccountsSyncPayload
} from '../../libs/accountsSync/accountsSync'
import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsole } from '../../../test/helpers/console'
import { mockUiManager } from '../../../test/helpers/ui'
import { BIP44_STANDARD_DERIVATION_TEMPLATE, HD_PATH_TEMPLATE_TYPE } from '../../consts/derivation'
import { Hex } from '../../interfaces/hex'
import { StoredKey, StoredKeystoreSeed } from '../../interfaces/keystore'
import { stripHexPrefix } from '../../utils/stripHexPrefix'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { KeystoreController } from './keystore'

const { CIPHER, CIPHER_OLD, getBytesForSecret, SCRYPT_PARAMS } = keystoreLib

const uiManager = mockUiManager().uiManager

const MOCK_MIGRATION_PASS = 'mockMigrationPass'

const MOCK_12_WORD_SEED =
  'fashion blossom click cost club ring vapor know wisdom enlist neither receive'
const MOCK_15_WORD_SEED =
  'slam armed evoke immense dial pizza relief sleep maple follow culture diamond scout frost pipe'
const MOCK_18_WORD_SEED =
  'fog notice squirrel foam enforce wheat stable unveil junior furnace curious voice cost there group runway detail jungle'
const MOCK_21_WORD_SEED =
  'note deliver music viable lake magnet meadow muscle young sentence reward fatal uncle young guilt slow region noise digital amount almost'
const MOCK_24_WORD_SEED =
  'fit emotion observe increase tank tray major original pause twin island artist say unusual great visa silly insect elder tilt orient betray bronze tackle'

const ALL_SEEDS: string[] = [
  MOCK_12_WORD_SEED,
  MOCK_15_WORD_SEED,
  MOCK_18_WORD_SEED,
  MOCK_21_WORD_SEED,
  MOCK_24_WORD_SEED,
  MOCK_24_WORD_SEED
]

const SEED_PASSPHRASE = 'somepassword#23'

const MOCK_INTERNAL_KEY: StoredKey = {
  addr: '0x085f8A348f6fBc6F8d8FC3f1e427473436506D65',
  type: 'internal',
  privKey: '0xc0487aa2280aa042b6ea1607e6ac502c850e5b0fcbdfad9460e404ac45f792b7',
  label: 'Internal Key 1',
  dedicatedToOneSA: false,
  meta: {
    createdAt: Date.now()
  }
}
const INVALID_KEY_PUBLIC_ADDR = '0xb49152a810590293E80466542DD907BD1F290E68'
const MOCK_TREZOR_KEY: StoredKey = {
  addr: '0x50E05A2c5598C8Add99752f572806686fC511a61',
  type: 'trezor',
  privKey: null,
  label: 'Trezor Key 1',
  dedicatedToOneSA: false,
  meta: {
    deviceId: '1',
    deviceModel: 'trezor',
    hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
    index: 1,
    createdAt: Date.now()
  }
}
const MOCK_LEDGER_KEY: StoredKey = {
  addr: '0x8E6807302eE6EfccBad37491a4d2B880Ca3f7deB',
  type: 'ledger',
  privKey: null,
  label: 'Ledger Key 1',
  dedicatedToOneSA: false,
  meta: {
    deviceId: '1',
    deviceModel: 'ledger',
    hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
    index: 1,
    createdAt: Date.now()
  }
}

const MOCK_INVALID_KEY: StoredKey = {
  addr: '0x33a597a919353e20894Cc8EE6C4709b54788A3ec',
  type: 'internal',
  privKey: '0x12345',
  label: 'Broken Internal Key',
  dedicatedToOneSA: false,
  meta: {
    createdAt: Date.now()
  }
}

const encryptSeedWithCtr = (
  seed: string,
  passphrase: string | null,
  key: Uint8Array,
  iv: Uint8Array
) => {
  const counter = new aes.Counter(iv)
  const aesCtr = new aes.ModeOfOperation.ctr(key, counter)

  return {
    seed: hexlify(aesCtr.encrypt(new TextEncoder().encode(seed))) as Hex,
    passphrase: passphrase
      ? (hexlify(aesCtr.encrypt(new TextEncoder().encode(passphrase))) as Hex)
      : null
  }
}

const encryptPrivateKeyWithCtr = (payload: string, key: Uint8Array, iv: Uint8Array) => {
  const counter = new aes.Counter(iv)
  const aesCtr = new aes.ModeOfOperation.ctr(key, counter)

  const without0x = payload.startsWith('0x') ? payload.slice(2) : payload

  return hexlify(aesCtr.encrypt(aes.utils.hex.toBytes(without0x)))
}

const encryptTextWithCtr = (payload: string, key: Uint8Array, iv: Uint8Array) => {
  const counter = new aes.Counter(iv)
  const aesCtr = new aes.ModeOfOperation.ctr(key, counter)

  return hexlify(aesCtr.encrypt(new TextEncoder().encode(payload)))
}

const createMockOldAesStorageFixture = async (
  {
    additionalMockSeeds = [],
    additionalMockKeys = []
  }: {
    additionalMockSeeds?: StoredKeystoreSeed[]
    additionalMockKeys?: StoredKey[]
  } = {
    additionalMockSeeds: [],
    additionalMockKeys: []
  }
) => {
  const entropyGenerator = new EntropyGenerator()

  const mainKey = {
    key: entropyGenerator.generateRandomBytes(16, ''),
    iv: entropyGenerator.generateRandomBytes(16, '')
  }

  const scryptAdapter = new ScryptAdapter('browser-webkit')

  const createSecretEntry = async (id: string, secret: string) => {
    const salt = entropyGenerator.generateRandomBytes(32, id)
    const key = await scryptAdapter.scrypt(getBytesForSecret(secret), salt, SCRYPT_PARAMS)

    const iv = entropyGenerator.generateRandomBytes(16, id)
    const derivedKey = key.slice(0, 16)
    const macPrefix = key.slice(16, 32)
    const counter = new aes.Counter(iv)
    const aesCtr = new aes.ModeOfOperation.ctr(derivedKey, counter)
    const ciphertext = aesCtr.encrypt(getBytes(concat([mainKey.key, mainKey.iv])))
    const mac = keccak256(concat([macPrefix, ciphertext]))

    return {
      id,
      scryptParams: { ...SCRYPT_PARAMS, salt: hexlify(salt) },
      aesEncrypted: {
        ciphertext: hexlify(ciphertext) as Hex,
        iv: hexlify(iv) as Hex,
        mac,
        cipherType: CIPHER_OLD as 'aes-128-ctr'
      }
    }
  }

  const mockSeeds: StoredKeystoreSeed[] = [
    ...ALL_SEEDS.map((seed, index) => {
      const { seed: encryptedSeed, passphrase: encryptedSeedPassphrase } = encryptSeedWithCtr(
        seed,
        index === ALL_SEEDS.length - 1 ? SEED_PASSPHRASE : null,
        mainKey.key,
        mainKey.iv
      )
      return {
        id: `seed-${seed.split(' ').length}-word${index === ALL_SEEDS.length - 1 ? '-with-passphrase' : ''}`,
        label: 'Recovery Phrase',
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE as HD_PATH_TEMPLATE_TYPE,
        seed: encryptedSeed,
        seedPassphrase: encryptedSeedPassphrase
      }
    }),
    ...additionalMockSeeds.map((seed) => {
      const { seed: encryptedSeed, passphrase: encryptedSeedPassphrase } = encryptSeedWithCtr(
        seed.seed as string,
        seed.seedPassphrase as string,
        mainKey.key,
        mainKey.iv
      )

      return {
        ...seed,
        seed: encryptedSeed,
        seedPassphrase: encryptedSeedPassphrase
      }
    })
  ]

  const mockKeys: StoredKey[] = [
    MOCK_INTERNAL_KEY,
    MOCK_TREZOR_KEY,
    MOCK_LEDGER_KEY,
    ...additionalMockKeys
  ].map(
    (key) =>
      ({
        ...key,
        privKey: key.privKey
          ? encryptPrivateKeyWithCtr(key.privKey as string, mainKey.key, mainKey.iv)
          : null
      }) as StoredKey
  )

  return {
    mainKey,
    createSecretEntry,
    mockSeeds,
    mockKeys
  }
}

const mockOldAesStorage = async (storageCtrl: StorageController, secret: string) => {
  const { createSecretEntry, mockSeeds, mockKeys } = await createMockOldAesStorageFixture()

  await storageCtrl.set('keystoreSecrets', [await createSecretEntry('password', secret)])
  await storageCtrl.set('keystoreSeeds', mockSeeds)
  await storageCtrl.set('keystoreKeys', mockKeys)
}

const mockOldAesStorageWithBiometrics = async (storageCtrl: StorageController) => {
  const { createSecretEntry, mockSeeds, mockKeys } = await createMockOldAesStorageFixture()

  await storageCtrl.set('keystoreSecrets', [
    await createSecretEntry('password', MOCK_MIGRATION_PASS),
    await createSecretEntry('biometrics', MOCK_MIGRATION_PASS)
  ])
  await storageCtrl.set('keystoreSeeds', mockSeeds)
  await storageCtrl.set('keystoreKeys', mockKeys)
}

// Builds an already-migrated (AES-GCM) secret entry for the given legacy main key. Used to simulate
// keystores where the secret was migrated to GCM but a previous run left the stored keys/seeds on AES-CTR.
const createGcmSecretEntry = async (
  id: string,
  secret: string,
  mainKey: { key: Uint8Array; iv: Uint8Array }
) => {
  const entropyGenerator = new EntropyGenerator()
  const salt = entropyGenerator.generateRandomBytes(32, id)
  const scryptAdapter = new ScryptAdapter('browser-webkit')
  const secretKey = await scryptAdapter.scrypt(getBytesForSecret(secret), salt, SCRYPT_PARAMS)

  const gcmMainKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(getBytes(concat([mainKey.key, mainKey.iv]))),
    { name: CIPHER },
    true,
    ['encrypt', 'decrypt']
  )

  const aesEncrypted = await keystoreLib.encryptMainKeyWithSecret(
    gcmMainKey,
    secretKey as Uint8Array<ArrayBuffer>
  )

  return {
    id,
    scryptParams: { ...SCRYPT_PARAMS, salt: hexlify(salt) },
    aesEncrypted
  }
}

// Flips the first byte of a hex string, to simulate a scanned payload that was tampered with.
const tamperFirstByte = (hex: string) => {
  const bytes = getBytes(hex)
  bytes[0] = bytes[0]! ^ 0xff

  return hexlify(bytes)
}

// Flips the first byte of a GCM payload's ciphertext to simulate tampering/corruption at rest.
const tamperGcmCiphertext = (payload: any) => {
  const bytes = getBytes(payload.ciphertext)
  bytes[0] = bytes[0]! ^ 0xff
  return { ...payload, ciphertext: hexlify(bytes) }
}

const keystoreSigners = { internal: KeystoreSigner, ledger: LedgerSigner }

const prepareTest = async (
  initialSetStorage?: (storageCtrl: StorageController) => Promise<void>,
  skipDefaultStorageSetup = false
) => {
  const storage = produceMemoryStore()
  const storageCtrl = new StorageController(storage)
  const uiCtrl = new UiController({ uiManager })

  if (!skipDefaultStorageSetup) {
    await mockOldAesStorage(storageCtrl, MOCK_MIGRATION_PASS)
  }

  if (initialSetStorage) {
    await initialSetStorage(storageCtrl)
  }

  const keystoreCtrl = new KeystoreController('default', storageCtrl, keystoreSigners, uiCtrl)
  await keystoreCtrl.initialLoadPromise

  return {
    keystoreCtrl,
    storageCtrl,
    uiCtrl
  }
}

describe('CTR to GCM migration', () => {
  it('should migrate secrets', async () => {
    const { keystoreCtrl, storageCtrl } = await prepareTest()

    const initialSecrets = await storageCtrl.get('keystoreSecrets', [])
    expect(initialSecrets).toHaveLength(1)
    expect(initialSecrets[0]!.aesEncrypted.cipherType).toBe(CIPHER_OLD)

    expect(keystoreCtrl.isUnlocked).toBe(false)
    expect(keystoreCtrl.isReadyToStoreKeys).toBe(true)

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)

    const secretsAfter = await storageCtrl.get('keystoreSecrets', [])
    expect(secretsAfter).toHaveLength(1)
    expect(secretsAfter[0]!.aesEncrypted.cipherType).toBe(CIPHER)
    expect(secretsAfter[0]?.aesEncrypted.ciphertext).not.toBe(
      initialSecrets[0]?.aesEncrypted.ciphertext
    )

    // Lock it again just in case
    keystoreCtrl.lock()

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)
  })
  it('should migrate seeds', async () => {
    const { keystoreCtrl, storageCtrl } = await prepareTest()

    const initialSeeds = await storageCtrl.get('keystoreSeeds', [])

    expect(initialSeeds).toHaveLength(6)
    expect(keystoreCtrl.isUnlocked).toBe(false)
    expect(initialSeeds[0]!.seed).toBeDefined()
    expect(typeof initialSeeds[0]?.seed).toBe('string')

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)
    expect(keystoreCtrl.seeds).toHaveLength(6)

    const rawSeedOne = (await keystoreCtrl.getSavedSeed('seed-12-word')).seed

    expect(rawSeedOne).toBe(MOCK_12_WORD_SEED)

    const rawSeedTwo = (await keystoreCtrl.getSavedSeed('seed-24-word')).seed

    expect(rawSeedTwo).toBe(MOCK_24_WORD_SEED)

    const rawSeedWithPassphrase = await keystoreCtrl.getSavedSeed('seed-24-word-with-passphrase')

    expect(rawSeedWithPassphrase.seed).toBe(MOCK_24_WORD_SEED)
    expect(rawSeedWithPassphrase.seedPassphrase).toBe(SEED_PASSPHRASE)

    const seedsAfter = await storageCtrl.get('keystoreSeeds', [])
    expect(seedsAfter).toHaveLength(6)
    expect(typeof seedsAfter[0]?.seed).not.toBe('string')
    expect(typeof seedsAfter[1]?.seed).not.toBe('string')
  })
  it('should migrate private keys', async () => {
    const { keystoreCtrl, storageCtrl } = await prepareTest()

    const initialKeys = await storageCtrl.get('keystoreKeys', [])

    expect(initialKeys).toHaveLength(3)
    expect(keystoreCtrl.isUnlocked).toBe(false)

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)
    expect(keystoreCtrl.keys).toHaveLength(3)

    const internalKeyJson = await keystoreCtrl.exportKeyWithPasscode(
      MOCK_INTERNAL_KEY.addr,
      MOCK_INTERNAL_KEY.type,
      'tempPass'
    )
    const wallet = await Wallet.fromEncryptedJson(JSON.parse(internalKeyJson), 'tempPass')
    expect(wallet.address).toBe(MOCK_INTERNAL_KEY.addr)

    const keysAfter = await storageCtrl.get('keystoreKeys', [])
    expect(keysAfter).toHaveLength(3)
    expect(
      keysAfter.filter(({ privKey }) => privKey !== null && typeof privKey === 'string').length
    ).toBe(0)
  })
  it('should migrate correctly on double unlock with the same secret', async () => {
    const { restore } = suppressConsole()
    const { keystoreCtrl, storageCtrl } = await prepareTest()

    const promise1 = keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)
    await wait(1)
    const promise2 = keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    await Promise.all([promise1, promise2])

    expect(keystoreCtrl.isUnlocked).toBe(true)

    const secretsAfter = await storageCtrl.get('keystoreSecrets', [])
    expect(secretsAfter).toHaveLength(1)
    expect(secretsAfter[0]!.aesEncrypted.cipherType).toBe(CIPHER)
    expect(secretsAfter[0]?.aesEncrypted.ciphertext).not.toBeUndefined()
    expect(keystoreCtrl.seeds).toHaveLength(6)

    const rawSeedOne = (await keystoreCtrl.getSavedSeed('seed-12-word')).seed

    expect(rawSeedOne).toBe(MOCK_12_WORD_SEED)

    const rawSeedTwo = (await keystoreCtrl.getSavedSeed('seed-24-word')).seed

    expect(rawSeedTwo).toBe(MOCK_24_WORD_SEED)

    const internalKeyJson = await keystoreCtrl.exportKeyWithPasscode(
      MOCK_INTERNAL_KEY.addr,
      MOCK_INTERNAL_KEY.type,
      'tempPass'
    )
    const wallet = await Wallet.fromEncryptedJson(JSON.parse(internalKeyJson), 'tempPass')
    expect(wallet.address).toBe(MOCK_INTERNAL_KEY.addr)

    restore()
  })
  it('should migrate correctly, even if the first unlocks were with wrong secrets', async () => {
    const { restore } = suppressConsole()
    const { keystoreCtrl, storageCtrl } = await prepareTest()

    const wrongUnlockPromise1 = keystoreCtrl.unlockWithSecret('password', 'wrongPass1')
    await wait(1)
    const wrongUnlockPromise2 = keystoreCtrl.unlockWithSecret('password', 'wrongPass2')
    await Promise.allSettled([wrongUnlockPromise1, wrongUnlockPromise2])

    expect(keystoreCtrl.isUnlocked).toBe(false)

    const secretsAfterWrongAttempts = await storageCtrl.get('keystoreSecrets', [])
    expect(secretsAfterWrongAttempts).toHaveLength(1)
    expect(secretsAfterWrongAttempts[0]!.aesEncrypted.cipherType).toBe(CIPHER_OLD)

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)

    const secretsAfter = await storageCtrl.get('keystoreSecrets', [])
    expect(secretsAfter).toHaveLength(1)
    expect(secretsAfter[0]!.aesEncrypted.cipherType).toBe(CIPHER)
    expect(secretsAfter[0]?.aesEncrypted.ciphertext).not.toBeUndefined()
    expect(keystoreCtrl.seeds).toHaveLength(6)

    restore()
  })
  it('HW private key entries are migrated correctly', async () => {
    const { keystoreCtrl, storageCtrl } = await prepareTest()

    const initialKeys = await storageCtrl.get('keystoreKeys', [])

    expect(initialKeys).toHaveLength(3)
    expect(keystoreCtrl.isUnlocked).toBe(false)

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)
    expect(keystoreCtrl.keys).toHaveLength(3)

    const trezorKey = keystoreCtrl.keys.find((k) => k.type === 'trezor')
    const ledgerKey = keystoreCtrl.keys.find((k) => k.type === 'ledger')

    // Cannot be exported because private keys of HWs are not stored
    await expect(
      keystoreCtrl.exportKeyWithPasscode(trezorKey!.addr, trezorKey!.type, 'tempPass')
    ).rejects.toThrow()
    await expect(
      keystoreCtrl.exportKeyWithPasscode(ledgerKey!.addr, ledgerKey!.type, 'tempPass')
    ).rejects.toThrow()

    const keysAfter = await storageCtrl.get('keystoreKeys', [])
    expect(keysAfter).toHaveLength(3)
    expect(keysAfter.filter(({ privKey }) => privKey === null).length).toBe(2)
  })
  it('should migrate with real storage data', async () => {
    // Uses different mock data to ensure it's not just working with the specific fixture we create in the test,
    // but can handle real-world data that was encrypted with the old method.
    const seeds = {
      12: 'maze raccoon else prevent melody poet rail shed sing love under because',
      15: 'chest good fun mimic camera draft tiger current slush movie first symptom bag wreck example',
      18: 'sudden shop illegal awkward kidney motion man enlist notice sound balance turkey learn mountain penalty sea crawl mercy',
      21: 'practice total hollow mansion tortoise minimum innocent depart spin vague loyal lamp decorate burst census purchase moment step false lunch powder',
      24: 'hub party field valve cliff help miracle rotate sock random picture early salt cloth nice dish prefer love caution prize clerk mimic purse spread',
      '24-with-passphrase':
        'buzz crawl extend pact flush model exhibit rescue patrol wrap bright equip glide peace decide diagram course number street guilt cluster excite derive hybrid'
    }

    const { keystoreCtrl, storageCtrl } = await prepareTest(async (storageCtrl) => {
      await storageCtrl.set('keystoreSecrets', JSON.parse(CTR_STORAGE.keystoreSecrets))
      await storageCtrl.set('keystoreSeeds', JSON.parse(CTR_STORAGE.keystoreSeeds))
      await storageCtrl.set('keystoreKeys', JSON.parse(CTR_STORAGE.keystoreKeys))
      await storageCtrl.set('keyStoreUid', CTR_STORAGE.keyStoreUid)
    }, true)

    expect(keystoreCtrl.isUnlocked).toBe(false)
    expect(keystoreCtrl.isReadyToStoreKeys).toBe(true)
    expect(keystoreCtrl.seeds).toHaveLength(6)
    expect(keystoreCtrl.keys).toHaveLength(6)

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)

    const secretsAfter = await storageCtrl.get('keystoreSecrets', [])
    expect(secretsAfter).toHaveLength(1)
    expect(secretsAfter[0]!.aesEncrypted.cipherType).toBe(CIPHER)
    expect(secretsAfter[0]?.aesEncrypted.ciphertext).not.toBeUndefined()
    expect(keystoreCtrl.seeds).toHaveLength(6)
    expect(keystoreCtrl.keys).toHaveLength(6)

    for (const seed of keystoreCtrl.seeds) {
      const { seed: decryptedSeed, seedPassphrase } = await keystoreCtrl.getSavedSeed(seed.id)

      expect(decryptedSeed).toBeDefined()
      expect(typeof decryptedSeed).toBe('string')

      const length = decryptedSeed.split(' ').length

      if (seedPassphrase) {
        expect(decryptedSeed).toBe(seeds[`${length}-with-passphrase` as keyof typeof seeds])
      } else {
        expect(decryptedSeed).toBe(seeds[length as keyof typeof seeds])
      }
    }

    const internalKeyJson = await keystoreCtrl.exportKeyWithPasscode(
      '0x72d9Cd4B2f614809101fc8537290Eb8828928811',
      'internal',
      'tempPass'
    )
    const wallet = await Wallet.fromEncryptedJson(JSON.parse(internalKeyJson), 'tempPass')
    expect(wallet.address).toBe('0x72d9Cd4B2f614809101fc8537290Eb8828928811')
  })
  it('should migrate only the secret on unlock if the seeds and keys are already migrated', async () => {
    const { keystoreCtrl, storageCtrl } = await prepareTest(async (storageCtrl) => {
      await mockOldAesStorageWithBiometrics(storageCtrl)
    })

    expect(keystoreCtrl.hasPasswordSecret).toBe(true)
    expect(keystoreCtrl.hasBiometricsSecret).toBe(true)

    const initialSecrets = await storageCtrl.get('keystoreSecrets', [])
    expect(initialSecrets).toHaveLength(2)
    expect(initialSecrets[0]!.aesEncrypted.cipherType).toBe(CIPHER_OLD)
    expect(initialSecrets[1]!.aesEncrypted.cipherType).toBe(CIPHER_OLD)

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)
    expect(keystoreCtrl.seeds).toHaveLength(6)
    expect(keystoreCtrl.keys).toHaveLength(3)

    const secretsAfterPasswordUnlock = await storageCtrl.get('keystoreSecrets', [])
    expect(secretsAfterPasswordUnlock).toHaveLength(2)
    expect(secretsAfterPasswordUnlock[0]!.aesEncrypted.cipherType).toBe(CIPHER)
    expect(secretsAfterPasswordUnlock[1]!.aesEncrypted.cipherType).toBe(CIPHER_OLD)

    const passwordSeedOne = await keystoreCtrl.getSavedSeed('seed-12-word')
    const passwordSeedTwo = await keystoreCtrl.getSavedSeed('seed-24-word')
    expect(passwordSeedOne.seed).toBe(MOCK_12_WORD_SEED)
    expect(passwordSeedTwo.seed).toBe(MOCK_24_WORD_SEED)

    const passwordInternalKeyJson = await keystoreCtrl.exportKeyWithPasscode(
      MOCK_INTERNAL_KEY.addr,
      MOCK_INTERNAL_KEY.type,
      'tempPass'
    )
    const passwordWallet = await Wallet.fromEncryptedJson(
      JSON.parse(passwordInternalKeyJson),
      'tempPass'
    )
    expect(passwordWallet.address).toBe(MOCK_INTERNAL_KEY.addr)

    keystoreCtrl.lock()

    await keystoreCtrl.unlockWithSecret('biometrics', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)

    const secretsAfterBiometricsUnlock = await storageCtrl.get('keystoreSecrets', [])
    expect(secretsAfterBiometricsUnlock).toHaveLength(2)
    expect(secretsAfterBiometricsUnlock[0]!.aesEncrypted.cipherType).toBe(CIPHER)
    expect(secretsAfterBiometricsUnlock[1]!.aesEncrypted.cipherType).toBe(CIPHER)

    const biometricsSeedOne = await keystoreCtrl.getSavedSeed('seed-12-word')
    const biometricsSeedTwo = await keystoreCtrl.getSavedSeed('seed-24-word')
    expect(biometricsSeedOne.seed).toBe(MOCK_12_WORD_SEED)
    expect(biometricsSeedTwo.seed).toBe(MOCK_24_WORD_SEED)

    const biometricsInternalKeyJson = await keystoreCtrl.exportKeyWithPasscode(
      MOCK_INTERNAL_KEY.addr,
      MOCK_INTERNAL_KEY.type,
      'tempPass'
    )
    const biometricsWallet = await Wallet.fromEncryptedJson(
      JSON.parse(biometricsInternalKeyJson),
      'tempPass'
    )
    expect(biometricsWallet.address).toBe(MOCK_INTERNAL_KEY.addr)
  })
  it('should not fail the entire migration if there is an invalid seed/private key entry that cannot be migrated', async () => {
    const { restore } = suppressConsole()
    const { keystoreCtrl, storageCtrl } = await prepareTest(async (storageCtrl) => {
      const fixture = await createMockOldAesStorageFixture()
      const invalidKeyCipherKey = fixture.mainKey.key
      const invalidKeyCipherIv = fixture.mainKey.iv

      await storageCtrl.set('keystoreSecrets', [
        await fixture.createSecretEntry('password', MOCK_MIGRATION_PASS)
      ])
      await storageCtrl.set('keystoreSeeds', [
        ...fixture.mockSeeds,
        {
          id: 'invalid-seed',
          label: 'Broken Recovery Phrase',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          seed: encryptTextWithCtr(
            'not a valid mnemonic phrase',
            invalidKeyCipherKey,
            invalidKeyCipherIv
          )
        }
      ])
      await storageCtrl.set('keystoreKeys', [
        ...fixture.mockKeys,
        {
          addr: INVALID_KEY_PUBLIC_ADDR,
          type: 'internal',
          privKey: encryptTextWithCtr(
            'not-a-hex-private-key',
            invalidKeyCipherKey,
            invalidKeyCipherIv
          ),
          label: 'Broken Internal Key',
          dedicatedToOneSA: false,
          meta: {
            createdAt: Date.now()
          }
        } as StoredKey
      ])
    })

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)
    expect(keystoreCtrl.seeds).toHaveLength(7)
    expect(keystoreCtrl.keys).toHaveLength(4)

    const migratedSeeds = await storageCtrl.get('keystoreSeeds', [])
    expect(migratedSeeds).toHaveLength(7)
    const migratedSeedOne = migratedSeeds.find(({ id }) => id === 'seed-12-word')
    const migratedSeedTwo = migratedSeeds.find(({ id }) => id === 'seed-24-word')
    const invalidSeed = migratedSeeds.find(({ id }) => id === 'invalid-seed')
    expect(typeof migratedSeedOne!.seed).not.toBe('string')
    expect(typeof migratedSeedTwo!.seed).not.toBe('string')
    // Not migrated
    expect(typeof invalidSeed!.seed).toBe('string')

    const migratedKeys = await storageCtrl.get('keystoreKeys', [])
    expect(migratedKeys).toHaveLength(4)
    const migratedInternalKey = migratedKeys.find(({ addr }) => addr === MOCK_INTERNAL_KEY.addr)
    const invalidMigratedKey = migratedKeys.find(({ addr }) => addr === INVALID_KEY_PUBLIC_ADDR)

    expect(typeof migratedInternalKey!.privKey).not.toBe('string')
    // String because the migration failed as expected
    expect(typeof invalidMigratedKey!.privKey).toBe('string')

    const rawSeedOne = (await keystoreCtrl.getSavedSeed('seed-12-word')).seed
    const rawSeedTwo = (await keystoreCtrl.getSavedSeed('seed-24-word')).seed
    expect(rawSeedOne).toBe(MOCK_12_WORD_SEED)
    expect(rawSeedTwo).toBe(MOCK_24_WORD_SEED)

    const internalKeyJson = await keystoreCtrl.exportKeyWithPasscode(
      MOCK_INTERNAL_KEY.addr,
      MOCK_INTERNAL_KEY.type,
      'tempPass'
    )
    const wallet = await Wallet.fromEncryptedJson(JSON.parse(internalKeyJson), 'tempPass')
    expect(wallet.address).toBe(MOCK_INTERNAL_KEY.addr)

    await expect(keystoreCtrl.getSavedSeed('invalid-seed')).rejects.toThrow()
    await expect(
      keystoreCtrl.exportKeyWithPasscode(INVALID_KEY_PUBLIC_ADDR, 'internal', 'tempPass')
    ).rejects.toThrow()

    restore()
  })
  it('should emit error on failed migration but not leak sensitive data', async () => {
    const { restore } = suppressConsole()
    const mockInvalidSeed = MOCK_12_WORD_SEED.split(' ').slice(0, 11).join(' ') // Invalid mnemonic with only 11 words
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const { keystoreCtrl } = await prepareTest(async (storageCtrl) => {
      const fixture = await createMockOldAesStorageFixture({
        additionalMockSeeds: [
          {
            id: 'invalid-seed',
            label: 'Broken Recovery Phrase',
            hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
            seed: mockInvalidSeed
          }
        ],
        additionalMockKeys: [MOCK_INVALID_KEY]
      })

      await storageCtrl.set('keystoreSecrets', [
        await fixture.createSecretEntry('password', MOCK_MIGRATION_PASS)
      ])
      await storageCtrl.set('keystoreSeeds', fixture.mockSeeds)
      await storageCtrl.set('keystoreKeys', fixture.mockKeys)
    })

    const emittedErrors: any[] = []

    keystoreCtrl.onError((error) => {
      emittedErrors.push(error)
    })

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)
    expect(consoleErrorSpy).toHaveBeenCalled()

    const logs = consoleErrorSpy.mock.calls.flat().map((arg) => {
      if (typeof arg === 'string') return arg
      if (arg instanceof Error) return arg.message
      if (typeof arg?.message === 'string') return arg.message

      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    const joinedEmittedErrorMessage = emittedErrors
      .map((error) => {
        return error.message.concat(error.error.message)
      })
      .join(' ')

    const joinedLog = logs.join(' ')

    expect(joinedEmittedErrorMessage).toContain(
      'Failed to migrate 1 keys and 1 seeds to AES-GCM encryption.'
    )
    expect(joinedLog).not.toContain(mockInvalidSeed)
    expect(joinedLog).not.toContain(String(MOCK_INVALID_KEY.privKey))

    expect(joinedEmittedErrorMessage).not.toContain(mockInvalidSeed)
    expect(joinedEmittedErrorMessage).not.toContain(String(MOCK_INVALID_KEY.privKey))

    consoleErrorSpy.mockRestore()
    restore()
  })
  it('should allow the user to view saved seeds and sign if the password is correct, even if the secret failed to migrate', async () => {
    const { restore } = suppressConsole()
    const { keystoreCtrl, storageCtrl } = await prepareTest()

    const encryptMainKeyWithSecretSpy = jest
      .spyOn(keystoreLib, 'encryptMainKeyWithSecret')
      .mockRejectedValueOnce(new Error('Encryption failed'))

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)
    expect(keystoreCtrl.seeds).toHaveLength(6)

    // Verify that seeds can be accessed despite the secret migration failing
    const rawSeedOne = (await keystoreCtrl.getSavedSeed('seed-12-word')).seed
    const rawSeedTwo = (await keystoreCtrl.getSavedSeed('seed-24-word')).seed

    expect(rawSeedOne).toBe(MOCK_12_WORD_SEED)
    expect(rawSeedTwo).toBe(MOCK_24_WORD_SEED)

    // The secret should still be in the old format because the migration failed
    const secretsAfter = await storageCtrl.get('keystoreSecrets', [])
    expect(secretsAfter).toHaveLength(1)
    expect(secretsAfter[0]!.aesEncrypted.cipherType).toBe(CIPHER_OLD)

    // Ensure that private keys are also accessible
    const internalKeyJson = await keystoreCtrl.exportKeyWithPasscode(
      MOCK_INTERNAL_KEY.addr,
      MOCK_INTERNAL_KEY.type,
      'tempPass'
    )
    const wallet = await Wallet.fromEncryptedJson(JSON.parse(internalKeyJson), 'tempPass')
    expect(wallet.address).toBe(MOCK_INTERNAL_KEY.addr)

    encryptMainKeyWithSecretSpy.mockRestore()
    restore()
  })
  it('should allow the user to sign messages if the password is correct, even if the secret failed to migrate', async () => {
    const { restore } = suppressConsole()
    const { keystoreCtrl } = await prepareTest()

    const encryptMainKeyWithSecretSpy = jest
      .spyOn(keystoreLib, 'encryptMainKeyWithSecret')
      .mockRejectedValueOnce(new Error('Encryption failed'))

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)
    expect(keystoreCtrl.keys).toHaveLength(3)

    const internalKey = keystoreCtrl.keys.find((k) => k.type === 'internal')!

    // Encode the message
    const message = toUtf8Bytes('Hello, world!')
    const signer = await keystoreCtrl.getSigner(internalKey.addr, internalKey.type)
    const signature = await signer.signMessage(hexlify(message))

    const valid = await verifyMessage({
      address: internalKey.addr,
      message: 'Hello, world!',
      signature: signature as Hex
    })

    expect(valid).toBe(true)

    encryptMainKeyWithSecretSpy.mockRestore()
    restore()
  })
  it('should not unlock a migrated keystore with the wrong password (GCM path)', async () => {
    const { restore } = suppressConsole()
    const { keystoreCtrl, storageCtrl } = await prepareTest()

    // First unlock migrates the secret to GCM
    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)
    const secretsAfter = await storageCtrl.get('keystoreSecrets', [])
    expect(secretsAfter[0]!.aesEncrypted.cipherType).toBe(CIPHER)

    keystoreCtrl.lock()
    expect(keystoreCtrl.isUnlocked).toBe(false)

    // A wrong password now goes through the GCM unlock path. It must be classified as an incorrect
    // password
    const emittedErrors: { level: string; message: string }[] = []
    keystoreCtrl.onError((e) => emittedErrors.push(e))

    await keystoreCtrl.unlockWithSecret('password', 'definitelyWrongPass')

    expect(keystoreCtrl.isUnlocked).toBe(false)
    expect(keystoreCtrl.errorMessage).toBe('Incorrect password. Please try again.')
    expect(
      emittedErrors.some(
        (e) => e.level === 'silent' && e.message === 'Incorrect password. Please try again.'
      )
    ).toBe(true)

    // The correct password still works afterwards (and clears the error)
    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)
    expect(keystoreCtrl.isUnlocked).toBe(true)
    expect(keystoreCtrl.errorMessage).toBe('')

    restore()
  })
  it('should surface an unexpected GCM unlock error instead of masking it as a wrong password', async () => {
    const { restore } = suppressConsole()
    const { keystoreCtrl } = await prepareTest(async (storageCtrl) => {
      const salt = new EntropyGenerator().generateRandomBytes(32, 'password')

      await storageCtrl.set('keystoreSecrets', [
        {
          id: 'password',
          scryptParams: { ...SCRYPT_PARAMS, salt: hexlify(salt) },
          // Invalid data
          aesEncrypted: { cipherType: CIPHER, ciphertext: '0xabcd', iv: '0xZZ' } as any
        }
      ])
      await storageCtrl.set('keystoreSeeds', [])
      await storageCtrl.set('keystoreKeys', [])
    }, true)

    const emittedErrors: { level: string; message: string }[] = []
    keystoreCtrl.onError((e) => emittedErrors.push(e))

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(false)
    // The failure must not be masked as a wrong password...
    expect(keystoreCtrl.errorMessage).not.toBe('Incorrect password. Please try again.')
    expect(emittedErrors.some((e) => e.level === 'major')).toBe(true)
    expect(emittedErrors.every((e) => e.message !== 'Incorrect password. Please try again.')).toBe(
      true
    )

    restore()
  })
  it('should finish migrating stored keys/seeds on the GCM path if a previous run left them on AES-CTR', async () => {
    // Simulate an interrupted/partially-failed migration: the secret was already migrated to GCM,
    // but the stored keys and seeds are still on AES-CTR. Because the secret is GCM, unlocking takes
    // the GCM path - which must still complete the payload migration instead of leaving them on CTR.
    const { keystoreCtrl, storageCtrl } = await prepareTest(async (storageCtrl) => {
      const fixture = await createMockOldAesStorageFixture()
      const gcmSecret = await createGcmSecretEntry('password', MOCK_MIGRATION_PASS, fixture.mainKey)

      await storageCtrl.set('keystoreSecrets', [gcmSecret])
      await storageCtrl.set('keystoreSeeds', fixture.mockSeeds)
      await storageCtrl.set('keystoreKeys', fixture.mockKeys)
    }, true)

    const secretsBefore = await storageCtrl.get('keystoreSecrets', [])
    const seedsBefore = await storageCtrl.get('keystoreSeeds', [])
    const keysBefore = await storageCtrl.get('keystoreKeys', [])
    // GCM
    expect(secretsBefore[0]!.aesEncrypted.cipherType).toBe(CIPHER)
    // Rest not migrated
    expect(typeof seedsBefore[0]?.seed).toBe('string')
    expect(keysBefore.some(({ privKey }) => typeof privKey === 'string')).toBe(true)

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)
    expect(keystoreCtrl.isUnlocked).toBe(true)

    // The payloads must now be migrated to GCM
    const seedsAfter = await storageCtrl.get('keystoreSeeds', [])
    const keysAfter = await storageCtrl.get('keystoreKeys', [])
    expect(seedsAfter.every(({ seed }) => typeof seed !== 'string')).toBe(true)
    expect(keysAfter.every(({ privKey }) => privKey === null || typeof privKey !== 'string')).toBe(
      true
    )

    // And they must decrypt correctly
    const rawSeed = (await keystoreCtrl.getSavedSeed('seed-12-word')).seed
    expect(rawSeed).toBe(MOCK_12_WORD_SEED)

    const internalKeyJson = await keystoreCtrl.exportKeyWithPasscode(
      MOCK_INTERNAL_KEY.addr,
      MOCK_INTERNAL_KEY.type,
      'tempPass'
    )
    const wallet = await Wallet.fromEncryptedJson(JSON.parse(internalKeyJson), 'tempPass')
    expect(wallet.address).toBe(MOCK_INTERNAL_KEY.addr)
  })
  it('should not rewrite stored keys/seeds on unlock when everything is already migrated', async () => {
    const { keystoreCtrl, storageCtrl } = await prepareTest()

    // First unlock performs the full migration
    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)
    keystoreCtrl.lock()

    const setSpy = jest.spyOn(storageCtrl, 'set')

    // Second unlock: everything is already GCM, so there must be no payload re-write
    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)
    expect(keystoreCtrl.isUnlocked).toBe(true)

    const payloadWrites = setSpy.mock.calls.filter(
      ([key]) => key === 'keystoreKeys' || key === 'keystoreSeeds'
    )
    expect(payloadWrites).toHaveLength(0)

    setSpy.mockRestore()
  })
  it('should reject reading a seed whose stored GCM ciphertext was tampered with', async () => {
    const { restore } = suppressConsole()
    const { keystoreCtrl, storageCtrl, uiCtrl } = await prepareTest()

    // Migrate everything to GCM, then lock
    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)
    keystoreCtrl.lock()

    // Tamper with the stored (GCM) seed ciphertext at rest
    const seeds = await storageCtrl.get('keystoreSeeds', [])
    const tamperedSeeds = seeds.map((s) =>
      s.id === 'seed-12-word' ? { ...s, seed: tamperGcmCiphertext(s.seed) } : s
    )
    await storageCtrl.set('keystoreSeeds', tamperedSeeds)

    // Create a new controller instance so the data is loaded from storage
    const tamperedCtrl = new KeystoreController('default', storageCtrl, keystoreSigners, uiCtrl)
    await tamperedCtrl.initialLoadPromise
    await tamperedCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)
    expect(tamperedCtrl.isUnlocked).toBe(true)

    // GCM authentication must reject the tampered seed
    await expect(tamperedCtrl.getSavedSeed('seed-12-word')).rejects.toThrow()
    // An untouched seed must still be readable
    expect((await tamperedCtrl.getSavedSeed('seed-24-word')).seed).toBe(MOCK_24_WORD_SEED)

    restore()
  })
  it('should reject signing with a key whose stored GCM ciphertext was tampered with', async () => {
    const { restore } = suppressConsole()
    const { keystoreCtrl, storageCtrl, uiCtrl } = await prepareTest()

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)
    keystoreCtrl.lock()

    // Tamper with the stored (GCM) private key ciphertext at rest
    const keys = await storageCtrl.get('keystoreKeys', [])
    const tamperedKeys = keys.map((k) =>
      k.addr === MOCK_INTERNAL_KEY.addr && k.privKey
        ? { ...k, privKey: tamperGcmCiphertext(k.privKey) }
        : k
    )
    await storageCtrl.set('keystoreKeys', tamperedKeys)

    const tamperedCtrl = new KeystoreController('default', storageCtrl, keystoreSigners, uiCtrl)
    await tamperedCtrl.initialLoadPromise
    await tamperedCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)
    expect(tamperedCtrl.isUnlocked).toBe(true)

    await expect(
      tamperedCtrl.getSigner(MOCK_INTERNAL_KEY.addr, MOCK_INTERNAL_KEY.type)
    ).rejects.toThrow()

    restore()
  })
})

describe('accounts sync from a device that never unlocked with its password', () => {
  const MOCK_BIOMETRICS_SECRET = 'mockBiometricsSecret'
  const IMPORTING_PASS = 'importingDevicePass'
  const SYNCED_SEED_ID = 'seed-12-word'
  const IMPORTING_OWN_KEY_PRIV = `0x${'11'.repeat(32)}`
  const IMPORTING_OWN_KEY_ADDR = new Wallet(IMPORTING_OWN_KEY_PRIV).address

  // A legacy keystore where biometrics were turned on after the GCM migration shipped, so that
  // secret is GCM while the password one, migrated only on an unlock that uses it, stays CTR
  const prepareLegacyBiometricsDevice = async ({
    seedId = SYNCED_SEED_ID,
    biometricsAsCtr = false,
    mapPasswordEntry = (entry: any) => entry
  }: {
    seedId?: string
    biometricsAsCtr?: boolean
    mapPasswordEntry?: (entry: any) => any
  } = {}) => {
    let mainKeyOld: { key: Uint8Array; iv: Uint8Array } | undefined

    const prepared = await prepareTest(async (storageCtrl) => {
      const fixture = await createMockOldAesStorageFixture()
      mainKeyOld = fixture.mainKey

      await storageCtrl.set('keystoreSecrets', [
        mapPasswordEntry(await fixture.createSecretEntry('password', MOCK_MIGRATION_PASS)),
        biometricsAsCtr
          ? await fixture.createSecretEntry('biometrics', MOCK_BIOMETRICS_SECRET)
          : await createGcmSecretEntry('biometrics', MOCK_BIOMETRICS_SECRET, fixture.mainKey)
      ])
      await storageCtrl.set('keystoreSeeds', fixture.mockSeeds)
      // Link the internal key to a seed, so the recovery phrase travels with it
      await storageCtrl.set(
        'keystoreKeys',
        fixture.mockKeys.map((key) =>
          key.type === 'internal' && key.addr === MOCK_INTERNAL_KEY.addr
            ? { ...key, meta: { ...key.meta, fromSeedId: seedId } }
            : key
        )
      )
    }, true)

    return { ...prepared, mainKeyOld: mainKeyOld! }
  }

  /** A legacy device the user just unlocked with biometrics, ready to export. */
  const prepareUnlockedLegacyDevice = async (
    options?: Parameters<typeof prepareLegacyBiometricsDevice>[0]
  ) => {
    const prepared = await prepareLegacyBiometricsDevice(options)
    await prepared.keystoreCtrl.unlockWithSecret('biometrics', MOCK_BIOMETRICS_SECRET)

    return prepared
  }

  const createImportingKeystore = async ({ withOwnKey = false } = {}) => {
    const importingStorageCtrl = new StorageController(produceMemoryStore())
    const importingCtrl = new KeystoreController(
      'default',
      importingStorageCtrl,
      keystoreSigners,
      new UiController({ uiManager })
    )
    await importingCtrl.initialLoadPromise
    await importingCtrl.addSecret('password', IMPORTING_PASS, '', true)

    if (withOwnKey)
      await importingCtrl.addKeys([
        {
          addr: IMPORTING_OWN_KEY_ADDR,
          label: 'Own Key',
          type: 'internal',
          privateKey: IMPORTING_OWN_KEY_PRIV,
          dedicatedToOneSA: false,
          meta: { createdAt: Date.now() }
        }
      ])

    return { importingCtrl, importingStorageCtrl }
  }

  const buildSyncPayload = (
    exported: Awaited<ReturnType<KeystoreController['exportForSync']>>
  ): AccountsSyncPayload => ({
    v: ACCOUNTS_SYNC_PAYLOAD_VERSION,
    accounts: [
      {
        addr: MOCK_INTERNAL_KEY.addr,
        associatedKeys: [MOCK_INTERNAL_KEY.addr],
        initialPrivileges: [],
        creation: null,
        preferences: { label: 'Account 1', pfp: MOCK_INTERNAL_KEY.addr }
      }
    ],
    ...exported
  })

  // Goes through the QR codes, so the payload has to survive the parser as well
  const throughTheQrCodes = (exported: Awaited<ReturnType<KeystoreController['exportForSync']>>) =>
    parseAccountsSyncPayload(getBytes(serializeAccountsSyncPayload(buildSyncPayload(exported))))

  const readImportedPrivateKey = async (importingCtrl: KeystoreController, addr: string) => {
    const json = await importingCtrl.exportKeyWithPasscode(addr, 'internal', 'tempPass')

    return (await Wallet.fromEncryptedJson(JSON.parse(json), 'tempPass')).privateKey
  }

  describe('exporting', () => {
    it('exports the main key still wrapped with AES-CTR after a biometrics only unlock', async () => {
      const { keystoreCtrl, storageCtrl } = await prepareUnlockedLegacyDevice()
      expect(keystoreCtrl.isUnlocked).toBe(true)

      // The unlock migrates the keys and seeds, but leaves the password secret where it was
      const secrets = await storageCtrl.get('keystoreSecrets', [])
      expect(secrets.find((s) => s.id === 'password')!.aesEncrypted.cipherType).toBe(CIPHER_OLD)
      expect(secrets.find((s) => s.id === 'biometrics')!.aesEncrypted.cipherType).toBe(CIPHER)

      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])

      expect(exported.secret.id).toBe('password')
      expect(exported.secret.aesEncrypted.cipherType).toBe(CIPHER_OLD)
      // Only the main key stays legacy - keys and seeds migrate on any unlock
      expect(exported.keys[0]!.privKey).toMatchObject({ cipherType: CIPHER })
      expect(exported.seeds[0]!.seed).toMatchObject({ cipherType: CIPHER })
    })

    it('exports after a biometrics unlock that migrated the biometrics secret itself', async () => {
      const { keystoreCtrl, storageCtrl } = await prepareUnlockedLegacyDevice({
        biometricsAsCtr: true
      })

      const secrets = await storageCtrl.get('keystoreSecrets', [])
      expect(secrets.find((s) => s.id === 'biometrics')!.aesEncrypted.cipherType).toBe(CIPHER)
      expect(secrets.find((s) => s.id === 'password')!.aesEncrypted.cipherType).toBe(CIPHER_OLD)

      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])
      expect(exported.secret.aesEncrypted.cipherType).toBe(CIPHER_OLD)
    })

    it('stamps the cipher of a secret stored before the cipher was recorded', async () => {
      const { keystoreCtrl, storageCtrl } = await prepareUnlockedLegacyDevice({
        mapPasswordEntry: (entry) => {
          const aesEncrypted = { ...entry.aesEncrypted }
          delete aesEncrypted.cipherType

          return { ...entry, aesEncrypted }
        }
      })

      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])
      expect(exported.secret.aesEncrypted.cipherType).toBe(CIPHER_OLD)

      // Stamped only on the way out - the entry at rest is left exactly as it was
      const stored = await storageCtrl.get('keystoreSecrets', [])
      expect(stored.find((s) => s.id === 'password')!.aesEncrypted.cipherType).toBeUndefined()

      const { importingCtrl } = await createImportingKeystore()
      await importingCtrl.importFromSync(throughTheQrCodes(exported), MOCK_MIGRATION_PASS)
      expect(importingCtrl.keys).toHaveLength(1)
    })

    it('refuses to export a main key wrapped with a cipher it cannot unwrap', async () => {
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice({
        mapPasswordEntry: (entry) => ({
          ...entry,
          aesEncrypted: { ...entry.aesEncrypted, cipherType: 'aes-256-cbc' }
        })
      })

      await expect(keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])).rejects.toThrow(
        'Something went wrong when preparing your accounts for syncing. Please unlock the app again'
      )
    })

    it('still refuses to export keys and seeds that are not migrated yet', async () => {
      // Never unlocked, so the stored keys and seeds are still AES-CTR
      const { keystoreCtrl } = await prepareLegacyBiometricsDevice()

      await expect(keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])).rejects.toThrow(
        'Something went wrong when preparing your accounts for syncing. Please try again.'
      )
    })

    it('exports a GCM wrapped main key once the user finally unlocks with the password', async () => {
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice()
      const legacyExport = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])
      expect(legacyExport.secret.aesEncrypted.cipherType).toBe(CIPHER_OLD)

      keystoreCtrl.lock()
      await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

      const migratedExport = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])
      expect(migratedExport.secret.aesEncrypted.cipherType).toBe(CIPHER)

      const { importingCtrl } = await createImportingKeystore()
      await importingCtrl.importFromSync(throughTheQrCodes(migratedExport), MOCK_MIGRATION_PASS)

      expect(await readImportedPrivateKey(importingCtrl, MOCK_INTERNAL_KEY.addr)).toBe(
        MOCK_INTERNAL_KEY.privKey
      )
    })

    it('puts nothing decrypted into the payload', async () => {
      const { keystoreCtrl, mainKeyOld } = await prepareUnlockedLegacyDevice()

      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])
      const serialized = JSON.stringify(buildSyncPayload(exported))
      const mainKeyHex = hexlify(concat([mainKeyOld.key, mainKeyOld.iv]))

      expect(serialized).not.toContain(MOCK_12_WORD_SEED)
      expect(serialized).not.toContain(MOCK_12_WORD_SEED.split(' ')[0])
      expect(serialized).not.toContain(MOCK_INTERNAL_KEY.privKey)
      expect(serialized).not.toContain(stripHexPrefix(MOCK_INTERNAL_KEY.privKey as string))
      expect(serialized).not.toContain(MOCK_MIGRATION_PASS)
      // The main key travels wrapped with the password, never in the clear
      expect(serialized).not.toContain(stripHexPrefix(mainKeyHex))
    })
  })

  describe('importing', () => {
    it('imports keys and seeds from an AES-CTR wrapped main key', async () => {
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice()
      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])

      const { importingCtrl, importingStorageCtrl } = await createImportingKeystore()
      await importingCtrl.importFromSync(throughTheQrCodes(exported), MOCK_MIGRATION_PASS)

      expect(await readImportedPrivateKey(importingCtrl, MOCK_INTERNAL_KEY.addr)).toBe(
        MOCK_INTERNAL_KEY.privKey
      )
      expect(importingCtrl.seeds).toHaveLength(1)
      expect((await importingCtrl.getSavedSeed(importingCtrl.seeds[0]!.id)).seed).toBe(
        MOCK_12_WORD_SEED
      )

      // Everything is re-encrypted with the importing device's own main key, so nothing
      // legacy is left behind on it
      const importedSecrets = await importingStorageCtrl.get('keystoreSecrets', [])
      expect(importedSecrets[0]!.aesEncrypted.cipherType).toBe(CIPHER)
      const importedStoredSeeds = await importingStorageCtrl.get('keystoreSeeds', [])
      expect(importedStoredSeeds[0]!.seed).toMatchObject({ cipherType: CIPHER })
      const importedStoredKeys = await importingStorageCtrl.get('keystoreKeys', [])
      expect(importedStoredKeys[0]!.privKey).toMatchObject({ cipherType: CIPHER })
    })

    it('carries the passphrase of a recovery phrase across the legacy path', async () => {
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice({
        seedId: 'seed-24-word-with-passphrase'
      })
      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])

      const { importingCtrl } = await createImportingKeystore()
      await importingCtrl.importFromSync(throughTheQrCodes(exported), MOCK_MIGRATION_PASS)

      const importedSeed = await importingCtrl.getSavedSeed(importingCtrl.seeds[0]!.id)
      expect(importedSeed.seed).toBe(MOCK_24_WORD_SEED)
      expect(importedSeed.seedPassphrase).toBe(SEED_PASSPHRASE)
    })

    it('leaves the recovery phrase behind when the user opted out of exporting it', async () => {
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice()
      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr], false)
      expect(exported.seeds).toHaveLength(0)

      const { importingCtrl } = await createImportingKeystore()
      await importingCtrl.importFromSync(throughTheQrCodes(exported), MOCK_MIGRATION_PASS)

      expect(importingCtrl.seeds).toHaveLength(0)
      // The key still signs on the other device, it is just no longer tied to a seed
      expect(await readImportedPrivateKey(importingCtrl, MOCK_INTERNAL_KEY.addr)).toBe(
        MOCK_INTERNAL_KEY.privKey
      )
      expect(importingCtrl.keys[0]!.meta.fromSeedId).toBeUndefined()
    })

    it('carries hardware wallet keys, which have no private key to decrypt', async () => {
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice()
      const exported = await keystoreCtrl.exportForSync([
        MOCK_INTERNAL_KEY.addr,
        MOCK_LEDGER_KEY.addr
      ])
      expect(exported.keys).toHaveLength(2)

      const { importingCtrl } = await createImportingKeystore()
      await importingCtrl.importFromSync(throughTheQrCodes(exported), MOCK_MIGRATION_PASS)

      const importedLedgerKey = importingCtrl.keys.find((k) => k.addr === MOCK_LEDGER_KEY.addr)
      expect(importedLedgerKey!.type).toBe('ledger')
      expect(importedLedgerKey!.isExternallyStored).toBe(true)
      expect(await readImportedPrivateKey(importingCtrl, MOCK_INTERNAL_KEY.addr)).toBe(
        MOCK_INTERNAL_KEY.privKey
      )
    })

    it('does not duplicate keys or seeds when the same payload is imported twice', async () => {
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice()
      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])
      const payload = throughTheQrCodes(exported)

      const { importingCtrl } = await createImportingKeystore()
      await importingCtrl.importFromSync(payload, MOCK_MIGRATION_PASS)
      await importingCtrl.importFromSync(payload, MOCK_MIGRATION_PASS)

      expect(importingCtrl.keys).toHaveLength(1)
      expect(importingCtrl.seeds).toHaveLength(1)
    })

    it('does not touch the main key or the secrets of the importing device', async () => {
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice()
      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])

      const { importingCtrl, importingStorageCtrl } = await createImportingKeystore({
        withOwnKey: true
      })
      const secretsBefore = await importingStorageCtrl.get('keystoreSecrets', [])

      await importingCtrl.importFromSync(throughTheQrCodes(exported), MOCK_MIGRATION_PASS)

      // The legacy unwrap must not leak into this device's own unlock state, so its own
      // key still decrypts with the main key it had before the import
      expect(importingCtrl.isUnlocked).toBe(true)
      expect(await readImportedPrivateKey(importingCtrl, IMPORTING_OWN_KEY_ADDR)).toBe(
        IMPORTING_OWN_KEY_PRIV
      )
      // The password of the exporting device does not become a way into this device
      expect(await importingStorageCtrl.get('keystoreSecrets', [])).toEqual(secretsBefore)
    })
  })

  describe('Negative cases', () => {
    it('does not import anything when the password of the legacy device is wrong', async () => {
      const { restore } = suppressConsole()
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice()
      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])

      const { importingCtrl } = await createImportingKeystore()

      await expect(
        importingCtrl.importFromSync(throughTheQrCodes(exported), 'wrongPass')
      ).rejects.toThrow('Incorrect password. Please try again.')

      expect(importingCtrl.errorMessage).toBe('Incorrect password. Please try again.')
      expect(importingCtrl.keys).toHaveLength(0)
      expect(importingCtrl.seeds).toHaveLength(0)

      restore()
    })

    it('does not import anything when the scanned AES-CTR main key was tampered with', async () => {
      const { restore } = suppressConsole()
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice()
      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])

      // AES-CTR is malleable, so the keccak mac is the only thing standing between a
      // tampered main key and the importing device decrypting garbage into its keystore
      const payload = throughTheQrCodes(exported)
      payload.secret.aesEncrypted.ciphertext = tamperFirstByte(
        payload.secret.aesEncrypted.ciphertext
      )

      const { importingCtrl } = await createImportingKeystore()

      await expect(importingCtrl.importFromSync(payload, MOCK_MIGRATION_PASS)).rejects.toThrow(
        'Incorrect password. Please try again.'
      )
      expect(importingCtrl.keys).toHaveLength(0)
      expect(importingCtrl.seeds).toHaveLength(0)

      restore()
    })

    it('does not import anything when the scanned iv was tampered with', async () => {
      const { restore } = suppressConsole()
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice()
      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])

      // The legacy mac covers the ciphertext only, so a tampered iv passes it and yields a
      // wrong main key. The GCM tag on the keys and seeds is what catches it
      const payload = throughTheQrCodes(exported)
      payload.secret.aesEncrypted.iv = tamperFirstByte(payload.secret.aesEncrypted.iv)

      const { importingCtrl } = await createImportingKeystore()

      await expect(importingCtrl.importFromSync(payload, MOCK_MIGRATION_PASS)).rejects.toThrow()
      // The mac did pass, so this is not reported to the user as a wrong password
      expect(importingCtrl.errorMessage).toBe('')
      expect(importingCtrl.keys).toHaveLength(0)
      expect(importingCtrl.seeds).toHaveLength(0)

      restore()
    })

    it('does not import anything when the scanned scrypt salt was tampered with', async () => {
      const { restore } = suppressConsole()
      const { keystoreCtrl } = await prepareUnlockedLegacyDevice()
      const exported = await keystoreCtrl.exportForSync([MOCK_INTERNAL_KEY.addr])

      // The parser cannot tell one salt from another, so a swapped one derives a different
      // key from the right password and has to fail the same way a wrong password does
      const payload = throughTheQrCodes(exported)
      payload.secret.scryptParams.salt = tamperFirstByte(payload.secret.scryptParams.salt)

      const { importingCtrl } = await createImportingKeystore()

      await expect(importingCtrl.importFromSync(payload, MOCK_MIGRATION_PASS)).rejects.toThrow(
        'Incorrect password. Please try again.'
      )
      expect(importingCtrl.keys).toHaveLength(0)

      restore()
    })
  })
})
