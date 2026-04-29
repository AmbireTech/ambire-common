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

const mockOldAesStorage = async (storageCtrl: StorageController, secret: string) => {
  const entropyGenerator = new EntropyGenerator()

  const mainKey = {
    key: entropyGenerator.generateRandomBytes(16, ''),
    iv: entropyGenerator.generateRandomBytes(16, '')
  }

  const scryptAdapter = new ScryptAdapter('browser-webkit')
  const key = await scryptAdapter.scrypt(
    getBytesForSecret(secret),
    // Mock salt
    getBytesForSecret('salt'),
    SCRYPT_PARAMS
  )

  const iv = entropyGenerator.generateRandomBytes(16, '')
  const derivedKey = key.slice(0, 16)
  const macPrefix = key.slice(16, 32)
  const counter = new aes.Counter(iv)
  const aesCtr = new aes.ModeOfOperation.ctr(derivedKey, counter)
  const ciphertext = aesCtr.encrypt(getBytes(concat([mainKey.key, mainKey.iv])))
  const mac = keccak256(concat([macPrefix, ciphertext]))

  const mockSecrets: MainKeyEncryptedWithSecret[] = [
    {
      id: 'password',
      scryptParams: { ...SCRYPT_PARAMS, salt: hexlify(getBytesForSecret('salt')) },
      aesEncrypted: {
        ciphertext: hexlify(ciphertext) as Hex,
        iv: hexlify(iv) as Hex,
        mac: mac,
        cipherType: CIPHER_OLD
      }
    }
  ]

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

  await storageCtrl.set('keystoreSecrets', mockSecrets)
  await storageCtrl.set('keystoreSeeds', mockSeeds)
  await storageCtrl.set('keystoreKeys', mockKeys)
}

const keystoreSigners = { internal: InternalSigner, ledger: LedgerSigner }

const prepareTest = async (
  initialSetStorage?: (storageCtrl: StorageController) => Promise<void>
) => {
  const storage = produceMemoryStore()
  const storageCtrl = new StorageController(storage)
  const uiCtrl = new UiController({ uiManager })

  if (initialSetStorage) {
    await initialSetStorage(storageCtrl)
  } else {
    await mockOldAesStorage(storageCtrl, MOCK_MIGRATION_PASS)
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
    })

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
})
