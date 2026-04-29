import aes from 'aes-js'
import { concat, getBytes, hexlify, keccak256, randomBytes, Wallet } from 'ethers'

import { EntropyGenerator } from '@/libs/entropyGenerator/entropyGenerator'
import { CIPHER, CIPHER_OLD, getBytesForSecret, SCRYPT_PARAMS } from '@/libs/keystore/keystore'
import { ScryptAdapter } from '@/libs/scrypt/scryptAdapter'
import wait from '@/utils/wait'
import { describe, expect } from '@jest/globals'
import { CTR_STORAGE, InternalSigner, LedgerSigner } from '@test/keystore'

import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsole } from '../../../test/helpers/console'
import { mockUiManager } from '../../../test/helpers/ui'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { Hex } from '../../interfaces/hex'
import {
  MainKeyEncryptedWithSecret,
  StoredKey,
  StoredKeystoreSeed
} from '../../interfaces/keystore'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { KeystoreController } from './keystore'

const uiManager = mockUiManager().uiManager

// Uses prepareTest to ensure that every test starts with a clean state of the keystore, so we can test migrations in isolation
// @TODO: Refactor the entire test file to not rely on state from previous tests and use prepareTest
const MOCK_MIGRATION_PASS = 'mockMigrationPass'
const MOCK_12_WORD_SEED =
  'fashion blossom click cost club ring vapor know wisdom enlist neither receive'
const MOCK_24_WORD_SEED =
  'fit emotion observe increase tank tray major original pause twin island artist say unusual great visa silly insect elder tilt orient betray bronze tackle'
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

const encryptSeedWithCtr = (payload: string, key: Uint8Array, iv: Uint8Array) => {
  const counter = new aes.Counter(iv)
  const aesCtr = new aes.ModeOfOperation.ctr(key, counter)

  return hexlify(aesCtr.encrypt(new TextEncoder().encode(payload)))
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

const createMockOldAesStorageFixture = async () => {
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
        cipherType: CIPHER_OLD
      }
    }
  }

  const mockSeeds: StoredKeystoreSeed[] = [
    {
      id: 'seed1',
      label: 'Recovery Phrase 1',
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      seed: encryptSeedWithCtr(MOCK_12_WORD_SEED, mainKey.key, mainKey.iv)
    },
    {
      id: 'seed2',
      label: 'Recovery Phrase 2',
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      seed: encryptSeedWithCtr(MOCK_24_WORD_SEED, mainKey.key, mainKey.iv)
    }
  ]

  const mockKeys: StoredKey[] = [MOCK_INTERNAL_KEY, MOCK_TREZOR_KEY, MOCK_LEDGER_KEY].map(
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

const keystoreSigners = { internal: InternalSigner, ledger: LedgerSigner }

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

    expect(initialSeeds).toHaveLength(2)
    expect(keystoreCtrl.isUnlocked).toBe(false)
    expect(initialSeeds[0]!.seed).toBeDefined()
    expect(typeof initialSeeds[0]?.seed).toBe('string')

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)
    expect(keystoreCtrl.seeds).toHaveLength(2)

    const rawSeedOne = (await keystoreCtrl.getSavedSeed(keystoreCtrl.seeds[0]!.id)).seed

    expect(rawSeedOne).toBe(MOCK_12_WORD_SEED)

    const rawSeedTwo = (await keystoreCtrl.getSavedSeed(keystoreCtrl.seeds[1]!.id)).seed

    expect(rawSeedTwo).toBe(MOCK_24_WORD_SEED)

    const seedsAfter = await storageCtrl.get('keystoreSeeds', [])
    expect(seedsAfter).toHaveLength(2)
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
    expect(keystoreCtrl.seeds).toHaveLength(2)

    const rawSeedOne = (await keystoreCtrl.getSavedSeed(keystoreCtrl.seeds[0]!.id)).seed

    expect(rawSeedOne).toBe(MOCK_12_WORD_SEED)

    const rawSeedTwo = (await keystoreCtrl.getSavedSeed(keystoreCtrl.seeds[1]!.id)).seed

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
    expect(keystoreCtrl.seeds).toHaveLength(2)

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
    const { keystoreCtrl, storageCtrl } = await prepareTest(async (storageCtrl) => {
      await storageCtrl.set('keystoreSecrets', JSON.parse(CTR_STORAGE.keystoreSecrets))
      await storageCtrl.set('keystoreSeeds', JSON.parse(CTR_STORAGE.keystoreSeeds))
      await storageCtrl.set('keystoreKeys', JSON.parse(CTR_STORAGE.keystoreKeys))
      await storageCtrl.set('keystoreUid', CTR_STORAGE.keyStoreUid)
    }, true)

    expect(keystoreCtrl.isUnlocked).toBe(false)
    expect(keystoreCtrl.isReadyToStoreKeys).toBe(true)
    expect(keystoreCtrl.seeds).toHaveLength(2)
    expect(keystoreCtrl.keys).toHaveLength(3)

    await keystoreCtrl.unlockWithSecret('password', MOCK_MIGRATION_PASS)

    expect(keystoreCtrl.isUnlocked).toBe(true)

    const secretsAfter = await storageCtrl.get('keystoreSecrets', [])
    expect(secretsAfter).toHaveLength(1)
    expect(secretsAfter[0]!.aesEncrypted.cipherType).toBe(CIPHER)
    expect(secretsAfter[0]?.aesEncrypted.ciphertext).not.toBeUndefined()
    expect(keystoreCtrl.seeds).toHaveLength(2)
    expect(keystoreCtrl.keys).toHaveLength(3)

    const rawSeedOne = (await keystoreCtrl.getSavedSeed(keystoreCtrl.seeds[0]!.id)).seed

    expect(rawSeedOne).toBe(MOCK_12_WORD_SEED)

    const rawSeedTwo = (await keystoreCtrl.getSavedSeed(keystoreCtrl.seeds[1]!.id)).seed

    expect(rawSeedTwo).toBe(MOCK_24_WORD_SEED)

    const internalKeyJson = await keystoreCtrl.exportKeyWithPasscode(
      MOCK_INTERNAL_KEY.addr,
      MOCK_INTERNAL_KEY.type,
      'tempPass'
    )
    const wallet = await Wallet.fromEncryptedJson(JSON.parse(internalKeyJson), 'tempPass')
    expect(wallet.address).toBe(MOCK_INTERNAL_KEY.addr)
  })
  it('should migrate only the secret on unlock if the seeds and keys are already migrated', async () => {
    const { keystoreCtrl, storageCtrl, uiCtrl } = await prepareTest(async (storageCtrl) => {
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
    expect(keystoreCtrl.seeds).toHaveLength(2)
    expect(keystoreCtrl.keys).toHaveLength(3)

    const secretsAfterPasswordUnlock = await storageCtrl.get('keystoreSecrets', [])
    expect(secretsAfterPasswordUnlock).toHaveLength(2)
    expect(secretsAfterPasswordUnlock[0]!.aesEncrypted.cipherType).toBe(CIPHER)
    expect(secretsAfterPasswordUnlock[1]!.aesEncrypted.cipherType).toBe(CIPHER_OLD)

    const passwordSeedOne = await keystoreCtrl.getSavedSeed(keystoreCtrl.seeds[0]!.id)
    const passwordSeedTwo = await keystoreCtrl.getSavedSeed(keystoreCtrl.seeds[1]!.id)
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

    const biometricsSeedOne = await keystoreCtrl.getSavedSeed(keystoreCtrl.seeds[0]!.id)
    const biometricsSeedTwo = await keystoreCtrl.getSavedSeed(keystoreCtrl.seeds[1]!.id)
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
          addr: '0x1111111111111111111111111111111111111111',
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
    expect(keystoreCtrl.seeds).toHaveLength(3)
    expect(keystoreCtrl.keys).toHaveLength(4)

    const migratedSeeds = await storageCtrl.get('keystoreSeeds', [])
    expect(migratedSeeds).toHaveLength(3)
    const migratedSeedOne = migratedSeeds.find(({ id }) => id === 'seed1')
    const migratedSeedTwo = migratedSeeds.find(({ id }) => id === 'seed2')
    const invalidSeed = migratedSeeds.find(({ id }) => id === 'invalid-seed')
    expect(typeof migratedSeedOne!.seed).not.toBe('string')
    expect(typeof migratedSeedTwo!.seed).not.toBe('string')
    // Not migrated
    expect(typeof invalidSeed!.seed).toBe('string')

    const migratedKeys = await storageCtrl.get('keystoreKeys', [])
    expect(migratedKeys).toHaveLength(4)
    const migratedInternalKey = migratedKeys.find(({ addr }) => addr === MOCK_INTERNAL_KEY.addr)
    const invalidMigratedKey = migratedKeys.find(
      ({ addr }) => addr === '0x1111111111111111111111111111111111111111'
    )

    expect(typeof migratedInternalKey!.privKey).not.toBe('string')
    // String because the migration failed as expected
    expect(typeof invalidMigratedKey!.privKey).toBe('string')

    const rawSeedOne = (await keystoreCtrl.getSavedSeed('seed1')).seed
    const rawSeedTwo = (await keystoreCtrl.getSavedSeed('seed2')).seed
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
      keystoreCtrl.exportKeyWithPasscode(
        '0x1111111111111111111111111111111111111111',
        'internal',
        'tempPass'
      )
    ).rejects.toThrow()

    restore()
  })
})
