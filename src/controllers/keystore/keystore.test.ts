/* eslint-disable @typescript-eslint/no-floating-promises */

import { ethers, Wallet } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'
import { InternalSigner, LedgerSigner } from '@test/keystore'

import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { mockUiManager } from '../../../test/helpers/ui'
import {
  BIP44_STANDARD_DERIVATION_TEMPLATE,
  LEGACY_POPULAR_DERIVATION_TEMPLATE
} from '../../consts/derivation'
import { PRIVACY_POOLS_SIGNING_KEY_PATH } from '../../consts/privacyPools'
import { ExternalKey, IKeystoreController, InternalKey } from '../../interfaces/keystore'
import { getPrivateKeyFromSeed, KeyIterator } from '../../libs/keyIterator/keyIterator'
import { stripHexPrefix } from '../../utils/stripHexPrefix'
import wait from '../../utils/wait'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { KeystoreController } from './keystore'

const uiManager = mockUiManager().uiManager

let keystore: IKeystoreController
const pass = 'hoiHoi'
const keystoreSigners = { internal: InternalSigner, ledger: LedgerSigner }

const privKey = stripHexPrefix(
  getPrivateKeyFromSeed(process.env.SEED, null, 5, BIP44_STANDARD_DERIVATION_TEMPLATE)
)
const keyPublicAddress = new ethers.Wallet(privKey).address

describe('KeystoreController', () => {
  const storage = produceMemoryStore()
  const storageCtrl = new StorageController(storage)
  const uiCtrl = new UiController({ uiManager })
  test('should initialize', () => {
    keystore = new KeystoreController('default', storageCtrl, keystoreSigners, uiCtrl)
    expect(keystore).toBeDefined()
  })

  describe('Negative cases - before unlock', () => {
    suppressConsoleBeforeEach()
    test('should not unlock with non-existent secret (when no secrets exist)', async () => {
      await keystore.unlockWithSecret('password', pass)

      expect(keystore.isUnlocked).toBe(false)
    })

    test('should throw an error if trying to get uid before adding secrets', () => {
      expect(keystore.getKeyStoreUid()).rejects.toThrow('keystore: adding secret before get uid')
    })
  })

  test('should add a secret', async () => {
    await keystore.addSecret('password', pass, '', false)

    expect(keystore.isUnlocked).toBe(false)
    expect(await keystore.isReadyToStoreKeys).toBe(true)
  })

  describe('Negative cases - unlocked', () => {
    suppressConsoleBeforeEach()
    test('should not unlock with non-existent secret (when secrets exist)', async () => {
      await keystore.unlockWithSecret('playstation', '')
      expect(keystore.isUnlocked).toBe(false)
    })

    test('should not unlock with wrong secret', async () => {
      try {
        await keystore.unlockWithSecret('password', `${pass}1`)
      } catch {
        expect(keystore.statuses.unlockWithSecret).toBe('ERROR')
      }
    })
  })

  test('should unlock with secret', async () => {
    await keystore.unlockWithSecret('password', pass)

    expect(keystore.isUnlocked).toBeTruthy()
  })

  test('should add an internal key', async () => {
    await keystore.addKeys([
      {
        addr: new Wallet(privKey).address,
        label: 'Key 1',
        type: 'internal',
        privateKey: privKey,
        dedicatedToOneSA: true,
        meta: {
          createdAt: new Date().getTime()
        }
      }
    ])

    expect(keystore.keys).toContainEqual(
      expect.objectContaining({ addr: keyPublicAddress, type: 'internal' })
    )
  })

  test('should not add twice internal key that is already added', async () => {
    // two keys with the same private key
    const keysWithPrivateKeyAlreadyAdded = [
      {
        addr: new Wallet(privKey).address,
        label: 'Key 1',
        type: 'internal' as const,
        privateKey: privKey,
        dedicatedToOneSA: false,
        meta: {
          createdAt: new Date().getTime()
        }
      },
      {
        addr: new Wallet(privKey).address,
        label: 'Key 2',
        type: 'internal' as const,
        privateKey: privKey,
        dedicatedToOneSA: false,
        meta: {
          createdAt: new Date().getTime()
        }
      }
    ]

    const anotherPrivateKeyNotAddedYet =
      '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
    const anotherPrivateKeyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'
    const keysWithPrivateKeyDuplicatedInParams = [
      // test key 3
      {
        addr: new Wallet(anotherPrivateKeyNotAddedYet).address,
        label: 'Key 2',
        type: 'internal' as const,
        privateKey: anotherPrivateKeyNotAddedYet,
        dedicatedToOneSA: false,
        meta: {
          createdAt: new Date().getTime()
        }
      },
      // test key 4 with the same private key as key 3
      {
        addr: new Wallet(anotherPrivateKeyNotAddedYet).address,
        label: 'Key 2',
        type: 'internal' as const,
        privateKey: anotherPrivateKeyNotAddedYet,
        dedicatedToOneSA: false,
        meta: {
          createdAt: new Date().getTime()
        }
      }
    ]

    await keystore.addKeys([
      ...keysWithPrivateKeyAlreadyAdded,
      ...keysWithPrivateKeyDuplicatedInParams
    ])

    const newKeys = keystore.keys.filter(
      (x) =>
        [anotherPrivateKeyPublicAddress, keyPublicAddress].includes(x.addr) && x.type === 'internal'
    )
    expect(newKeys).toHaveLength(2)
  })

  test('should add an external key', async () => {
    const publicAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

    await keystore.addKeysExternallyStored([
      {
        addr: publicAddress,
        dedicatedToOneSA: false,
        type: 'trezor',
        label: 'Trezor Key 1',
        meta: {
          deviceId: '1',
          deviceModel: 'trezor',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          index: 1,
          createdAt: new Date().getTime()
        }
      }
    ])

    expect(keystore.keys).toContainEqual(
      expect.objectContaining({ addr: publicAddress, type: 'trezor' })
    )
  })

  test('should not add twice external key that is already added', async () => {
    const publicAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    const keysWithPrivateKeyAlreadyAdded: ExternalKey[] = [
      // test key 1
      {
        addr: publicAddress,
        type: 'trezor' as const,
        dedicatedToOneSA: false,
        label: 'Trezor Key 1',
        meta: {
          deviceId: '1',
          deviceModel: 'trezor',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          index: 1,
          createdAt: new Date().getTime()
        }
      },
      // test key 2 with the same id (public address) as test key 1'
      {
        addr: publicAddress,
        type: 'trezor' as const,
        dedicatedToOneSA: false,
        label: 'Trezor Key 2',
        meta: {
          deviceId: '1',
          deviceModel: 'trezor',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          index: 1,
          createdAt: new Date().getTime()
        }
      }
    ]

    const anotherAddressNotAddedYet = '0x42c06A1722DEb11022A339d3448BafFf8dFF99Ac'
    const keysWithPrivateKeyDuplicatedInParams: ExternalKey[] = [
      // test key 3
      {
        addr: anotherAddressNotAddedYet,
        type: 'trezor' as const,
        dedicatedToOneSA: false,
        label: 'Trezor Key 3',
        meta: {
          deviceId: '1',
          deviceModel: 'trezor',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          index: 1,
          createdAt: new Date().getTime()
        }
      },
      // test key 4 with the same private key as key 3',
      {
        addr: anotherAddressNotAddedYet,
        type: 'trezor' as const,
        dedicatedToOneSA: false,
        label: 'Trezor Key 4',
        meta: {
          deviceId: '1',
          deviceModel: 'trezor',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          index: 1,
          createdAt: new Date().getTime()
        }
      }
    ]

    await keystore.addKeysExternallyStored([
      ...keysWithPrivateKeyAlreadyAdded,
      ...keysWithPrivateKeyDuplicatedInParams
    ])

    const newKeys = keystore.keys
      .map(({ addr }) => addr)
      .filter((addr) => [publicAddress, anotherAddressNotAddedYet].includes(addr))

    expect(newKeys).toHaveLength(2)
  })

  test('should add both keys when they have the same address but different type', async () => {
    const externalKeysToAddWithDuplicateOnes: ExternalKey[] = [
      {
        addr: keyPublicAddress,
        type: 'trezor' as const,
        dedicatedToOneSA: false,
        label: 'Trezor Key 1',
        meta: {
          deviceId: '1',
          deviceModel: 'trezor',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          index: 1,
          createdAt: new Date().getTime()
        }
      },
      {
        addr: keyPublicAddress,
        type: 'trezor' as const,
        dedicatedToOneSA: false,
        label: 'Trezor Key 2',
        meta: {
          deviceId: '1',
          deviceModel: 'trezor',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          index: 1,
          createdAt: new Date().getTime()
        }
      },
      {
        addr: keyPublicAddress,
        type: 'ledger' as const,
        dedicatedToOneSA: false,
        label: 'Trezor Key 3',
        meta: {
          deviceId: '1',
          deviceModel: 'trezor',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          index: 1,
          createdAt: new Date().getTime()
        }
      }
    ]

    await keystore.addKeysExternallyStored(externalKeysToAddWithDuplicateOnes)

    expect(
      keystore.keys.filter((x) => x.addr === keyPublicAddress && x.type === 'trezor').length
    ).toEqual(1)
    expect(
      keystore.keys.filter((x) => x.addr === keyPublicAddress && x.type === 'ledger').length
    ).toEqual(1)
    // Note: previous test adds internal key with the same address
    expect(
      keystore.keys.filter((x) => x.addr === keyPublicAddress && x.type === 'internal').length
    ).toEqual(1)
  })

  test('should change keystore password', async () => {
    await keystore.changeKeystorePassword(`${pass}1`, pass)

    const secrets = await storage.get('keystoreSecrets', [])
    expect(secrets).toHaveLength(1)
  })

  test('should get an internal signer', async () => {
    expect.assertions(2)
    const internalSigner: any = await keystore.getSigner(keyPublicAddress, 'internal')
    expect(internalSigner.privKey).toEqual(privKey)
    expect(internalSigner.key.addr).toEqual(keyPublicAddress)
  })

  describe('Negative cases - seeds', () => {
    suppressConsoleBeforeEach()

    test('should not get a signer', () => {
      expect(
        keystore.getSigner('0xc7E32B118989296eaEa88D86Bd9041Feca77Ed36', 'internal')
      ).rejects.toThrow('keystore: key not found')
    })
    test('should throw not unlocked', () => {
      keystore.lock()

      expect(keystore.getSigner(keyPublicAddress, 'internal')).rejects.toThrow(
        'keystore: not unlocked'
      )
    })

    test('should export key backup, create wallet and compare public address', async () => {
      // changeKeystorePassword changed the password in the tests above so now unlock with the new password
      await keystore.unlockWithSecret('password', `${pass}1`)

      const keyBackup = await keystore.exportKeyWithPasscode(
        keyPublicAddress,
        'internal',
        'goshoPazara'
      )
      const wallet = await Wallet.fromEncryptedJson(JSON.parse(keyBackup), 'goshoPazara')
      expect(wallet.address).toBe(keyPublicAddress)
    })
  })

  test('should return uid', async () => {
    const keystoreUid = await keystore.getKeyStoreUid()
    expect(keystoreUid.length).toBe(128)
  })
  test('should remove key', async () => {
    const keyLengthBefore = keystore.keys.length
    // An internal key and a trezor key with the same public address
    const keysWithSamePublicAddress = keystore.keys.filter(
      (x) => x.addr === '0xe95DB32209A2E132B262Ab12BAFf8F6007e30254'
    )
    // First remove the internal key
    const internalKeyToRemove = keysWithSamePublicAddress.find(
      (x) => x.type === 'internal'
    ) as InternalKey
    expect(keysWithSamePublicAddress.length).toBeGreaterThanOrEqual(2)
    await keystore.removeKey(internalKeyToRemove?.addr || '', internalKeyToRemove?.type || '')
    expect(keystore.keys.length).toBe(keyLengthBefore - 1)
    const keysWithSamePublicAddressAfter = keystore.keys.filter(
      (x) => x.addr === '0xe95DB32209A2E132B262Ab12BAFf8F6007e30254'
    )
    const hwWalletKeyToRemove = keysWithSamePublicAddressAfter.find(
      (x) => x.type === 'trezor'
    ) as ExternalKey
    // Make sure the trezor key is not removed
    expect(hwWalletKeyToRemove).toBeDefined()
    // Remove the trezor key
    await keystore.removeKey(hwWalletKeyToRemove?.addr || '', hwWalletKeyToRemove?.type || '')
    // Make sure both keys are removed
    expect(keystore.keys.length).toBe(keyLengthBefore - 2)
  })
  test('should add keystore seed phrase', async () => {
    expect(keystore.seeds.length).toBe(0)
    expect(keystore.isUnlocked).toBeTruthy()
    await keystore.addSeed({
      seed: process.env.SEED,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    expect(keystore.seeds.length).toBe(1)
    expect(keystore.seeds[0]!.label).toBe('Recovery Phrase 1')
    expect(keystore.seeds[0]!.hdPathTemplate).toBe(BIP44_STANDARD_DERIVATION_TEMPLATE)
  })
  test('should update existing seed', async () => {
    expect(keystore.seeds.length).toBe(1)
    await keystore.updateSeed({
      id: keystore.seeds[0]!.id,
      label: 'New Label',
      hdPathTemplate: LEGACY_POPULAR_DERIVATION_TEMPLATE
    })
    expect(keystore.seeds.length).toBe(1)
    expect(keystore.seeds[0]!.label).toBe('New Label')
    expect(keystore.seeds[0]!.hdPathTemplate).toBe(LEGACY_POPULAR_DERIVATION_TEMPLATE)
  })
  it('getKeystoreSeed works', async () => {
    const keyIterator = new KeyIterator(process.env.SEED)

    const keystoreSeed = await keystore.getKeystoreSeed(keyIterator)

    expect(keystoreSeed).toBeDefined()
    expect(keystoreSeed?.seedPassphrase).toBeNull()
    expect(keystoreSeed?.seed).toBeDefined()
    expect(typeof keystoreSeed?.seed).toBe('object')
  })
})

describe('KeystoreController recovery phrase backup state', () => {
  let keystoreCtrl: IKeystoreController

  beforeEach(async () => {
    const storageCtrl = new StorageController(produceMemoryStore())
    const uiCtrl = new UiController({ uiManager })
    keystoreCtrl = new KeystoreController('default', storageCtrl, keystoreSigners, uiCtrl)
    await keystoreCtrl.addSecret('password', pass, '', false)
    await keystoreCtrl.unlockWithSecret('password', pass)
  })

  test('a generated phrase is flagged as not backed up', async () => {
    const tempSeed = await keystoreCtrl.generateTempSeed({})
    expect(tempSeed.notBackedUp).toBe(true)

    await keystoreCtrl.persistTempSeed()

    expect(keystoreCtrl.seeds.length).toBe(1)
    expect(keystoreCtrl.seeds[0]!.notBackedUp).toBe(true)
  })

  test('an imported phrase is not flagged, as the user has already seen it', async () => {
    await keystoreCtrl.addTempSeed({
      seed: process.env.SEED,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    await keystoreCtrl.persistTempSeed()

    expect(keystoreCtrl.seeds[0]!.notBackedUp).toBeFalsy()
  })

  test('markSeedAsBackedUp clears the flag and does not touch other seeds', async () => {
    await keystoreCtrl.generateTempSeed({})
    await keystoreCtrl.persistTempSeed()
    await keystoreCtrl.addTempSeed({
      seed: process.env.SEED,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      notBackedUp: true
    })
    await keystoreCtrl.persistTempSeed()

    expect(keystoreCtrl.seeds.length).toBe(2)
    const [firstSeed, secondSeed] = keystoreCtrl.seeds

    await keystoreCtrl.markSeedAsBackedUp(secondSeed!.id)

    expect(keystoreCtrl.seeds.find((s) => s.id === secondSeed!.id)?.notBackedUp).toBe(false)
    expect(keystoreCtrl.seeds.find((s) => s.id === firstSeed!.id)?.notBackedUp).toBe(true)
  })

  test('a phrase generated and stored at once is flagged like a generated temp seed', async () => {
    const seedId = await keystoreCtrl.addGeneratedSeed({})

    expect(keystoreCtrl.seeds.map((seed) => seed.id)).toEqual([seedId])
    expect(keystoreCtrl.seeds[0]!.notBackedUp).toBe(true)
    expect(keystoreCtrl.seeds[0]!.hdPathTemplate).toBe(BIP44_STANDARD_DERIVATION_TEMPLATE)
    // Stored encrypted and recoverable, as a valid phrase
    const { seed } = await keystoreCtrl.getSavedSeed(seedId)
    expect(seed.split(' ')).toHaveLength(12)
  })

  test('generating a stored phrase leaves the temp seed of another flow alone', async () => {
    await keystoreCtrl.addTempSeed({
      seed: process.env.SEED,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })

    await keystoreCtrl.addGeneratedSeed({})
    await keystoreCtrl.persistTempSeed()

    expect(keystoreCtrl.seeds).toHaveLength(2)
    expect(keystoreCtrl.seeds.filter((seed) => seed.notBackedUp)).toHaveLength(1)
  })

  const addPhrase = async (seed: string, seedPassphrase?: string) => {
    await keystoreCtrl.addTempSeed({
      seed,
      seedPassphrase,
      // Derives with the saved passphrase, as for phrases added before saving became optional
      shouldSavePassphrase: true,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    await keystoreCtrl.persistTempSeed()

    return keystoreCtrl.seeds.at(-1)!.id
  }

  test('derives the Privacy Pools signing key exactly as from the phrase itself', async () => {
    const seedId = await keystoreCtrl.addGeneratedSeed({})
    const { seed } = await keystoreCtrl.getSavedSeed(seedId)

    const key = await keystoreCtrl.derivePrivacyPoolsKey(seedId, PRIVACY_POOLS_SIGNING_KEY_PATH)
    const keyAgain = await keystoreCtrl.derivePrivacyPoolsKey(
      seedId,
      PRIVACY_POOLS_SIGNING_KEY_PATH
    )

    const expectedKey = ethers.HDNodeWallet.fromMnemonic(
      ethers.Mnemonic.fromPhrase(seed),
      PRIVACY_POOLS_SIGNING_KEY_PATH
    ).privateKey
    expect(key).toBe(expectedKey)
    expect(keyAgain).toBe(expectedKey)
  })

  test('derives the Privacy Pools signing key with the phrase passphrase', async () => {
    const withoutPassphrase = await addPhrase(process.env.SEED)
    const withPassphrase = await addPhrase(process.env.SEED, 'extra word')

    const key = await keystoreCtrl.derivePrivacyPoolsKey(
      withPassphrase,
      PRIVACY_POOLS_SIGNING_KEY_PATH
    )

    expect(key).toBe(
      ethers.HDNodeWallet.fromMnemonic(
        ethers.Mnemonic.fromPhrase(process.env.SEED, 'extra word'),
        PRIVACY_POOLS_SIGNING_KEY_PATH
      ).privateKey
    )
    expect(key).not.toBe(
      await keystoreCtrl.derivePrivacyPoolsKey(withoutPassphrase, PRIVACY_POOLS_SIGNING_KEY_PATH)
    )
  })

  test('refuses any key but the Privacy Pools signing key, and any key once locked', async () => {
    const seedId = await keystoreCtrl.addGeneratedSeed({})
    await keystoreCtrl.derivePrivacyPoolsKey(seedId, PRIVACY_POOLS_SIGNING_KEY_PATH)

    const refusedPaths = [
      // The user's EVM keys
      "m/44'/60'/0'/0/0",
      // A note secret of the old BIP-32 scheme, below the signing key
      "m/28784'/1'/0'/0'/0'/0'",
      // Another Privacy Pools account, which the wallet never uses
      "m/28784'/1'/1'",
      // The parent of every Privacy Pools key
      "m/28784'/1'",
      `${PRIVACY_POOLS_SIGNING_KEY_PATH}/`,
      ` ${PRIVACY_POOLS_SIGNING_KEY_PATH}`
    ]
    for (const path of refusedPaths) {
      await expect(keystoreCtrl.derivePrivacyPoolsKey(seedId, path)).rejects.toThrow(
        "refusing to derive a key outside Privacy Pools' paths"
      )
    }

    keystoreCtrl.lock()
    await expect(
      keystoreCtrl.derivePrivacyPoolsKey(seedId, PRIVACY_POOLS_SIGNING_KEY_PATH)
    ).rejects.toThrow('keystore: not unlocked')
  })

  test('markSeedAsBackedUp is a no-op for an unknown phrase id', async () => {
    await keystoreCtrl.generateTempSeed({})
    await keystoreCtrl.persistTempSeed()

    await keystoreCtrl.markSeedAsBackedUp('does-not-exist')

    expect(keystoreCtrl.seeds[0]!.notBackedUp).toBe(true)
  })
})

describe('KeystoreController recovery phrase passphrases', () => {
  const PASSPHRASE = 'extra word'
  const OTHER_PASSPHRASE = 'another word'
  let storageCtrl: StorageController
  let keystoreCtrl: IKeystoreController

  const masterFingerprint = (passphrase: string) =>
    ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(process.env.SEED, passphrase), 'm')
      .fingerprint

  const addPhrase = async (seedPassphrase?: string, shouldSavePassphrase?: boolean) => {
    await keystoreCtrl.addTempSeed({
      seed: process.env.SEED,
      seedPassphrase,
      shouldSavePassphrase,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    await keystoreCtrl.persistTempSeed()

    // The entry it was added to, which is not the last one when it matched an existing entry
    const storedSeed = await keystoreCtrl.getKeystoreSeed(
      new KeyIterator(process.env.SEED, seedPassphrase)
    )
    return storedSeed!.id
  }

  const seedById = (id: string) => keystoreCtrl.seeds.find((seed) => seed.id === id)!

  beforeEach(async () => {
    storageCtrl = new StorageController(produceMemoryStore())
    keystoreCtrl = new KeystoreController(
      'default',
      storageCtrl,
      keystoreSigners,
      new UiController({ uiManager })
    )
    await keystoreCtrl.addSecret('password', pass, '', false)
    await keystoreCtrl.unlockWithSecret('password', pass)
  })

  test('does not save the passphrase unless asked to, keeping only its fingerprint', async () => {
    const seedId = await addPhrase(PASSPHRASE)

    expect(seedById(seedId)).toMatchObject({
      withPassphrase: true,
      isPassphraseSaved: false,
      passphraseLabel: '1'
    })
    const savedSeed = await keystoreCtrl.getSavedSeed(seedId)
    expect(savedSeed.seedPassphrase).toBeNull()
    expect(savedSeed.passphraseFingerprint).toBe(masterFingerprint(PASSPHRASE))
    const [storedSeed] = await storageCtrl.get('keystoreSeeds', [])
    expect(storedSeed.seedPassphrase).toBeNull()
  })

  test('saves the passphrase when the user asks to', async () => {
    const seedId = await addPhrase(PASSPHRASE, true)

    expect(seedById(seedId)).toMatchObject({ withPassphrase: true, isPassphraseSaved: true })
    expect((await keystoreCtrl.getSavedSeed(seedId)).seedPassphrase).toBe(PASSPHRASE)
  })

  test('a phrase without a passphrase is not marked, and ignores the save flag', async () => {
    const seedId = await addPhrase(undefined, true)

    expect(seedById(seedId)).toMatchObject({ withPassphrase: false, isPassphraseSaved: false })
    expect(seedById(seedId).passphraseLabel).toBeUndefined()
  })

  test('each passphrase of the same phrase gets its own entry, named after the phrase', async () => {
    const standard = await addPhrase()
    await keystoreCtrl.updateSeed({ id: standard, label: 'Savings' })
    const first = await addPhrase(PASSPHRASE)
    const second = await addPhrase(OTHER_PASSPHRASE, true)

    expect(keystoreCtrl.seeds).toHaveLength(3)
    expect(seedById(first)).toMatchObject({ label: 'Savings', passphraseLabel: '1' })
    expect(seedById(second)).toMatchObject({ label: 'Savings', passphraseLabel: '2' })
  })

  test('the same passphrase again adds to its entry, whether it is saved or not', async () => {
    const notSaved = await addPhrase(PASSPHRASE)
    const saved = await addPhrase(OTHER_PASSPHRASE, true)

    expect(await addPhrase(PASSPHRASE)).toBe(notSaved)
    expect(await addPhrase(OTHER_PASSPHRASE)).toBe(saved)
    expect(keystoreCtrl.seeds).toHaveLength(2)
  })

  test('the same passphrase entered again with saving on saves it on its entry', async () => {
    const seedId = await addPhrase(PASSPHRASE)

    expect(await addPhrase(PASSPHRASE, true)).toBe(seedId)
    expect(seedById(seedId).isPassphraseSaved).toBe(true)
    expect((await keystoreCtrl.getSavedSeed(seedId)).seedPassphrase).toBe(PASSPHRASE)
  })

  test('a new passphrase takes the lowest number no other passphrase of the phrase uses', async () => {
    const first = await addPhrase(PASSPHRASE)
    await addPhrase(OTHER_PASSPHRASE)
    await keystoreCtrl.updateSeed({ id: first, passphraseLabel: 'Travel' })

    const third = await addPhrase('third word')

    expect(seedById(third).passphraseLabel).toBe('1')
  })

  test('renaming one entry leaves the other entries of the same phrase alone', async () => {
    const first = await addPhrase(PASSPHRASE)
    const second = await addPhrase(OTHER_PASSPHRASE)

    await keystoreCtrl.updateSeed({ id: first, label: 'Travel phrase', passphraseLabel: 'Travel' })

    expect(seedById(first)).toMatchObject({ label: 'Travel phrase', passphraseLabel: 'Travel' })
    expect(seedById(second)).toMatchObject({ label: 'Recovery Phrase 1', passphraseLabel: '2' })
  })

  test('a phrase without a passphrase has no passphrase name to set', async () => {
    const seedId = await addPhrase()

    await keystoreCtrl.updateSeed({ id: seedId, passphraseLabel: 'Travel' })

    expect(seedById(seedId).passphraseLabel).toBeUndefined()
  })

  test('tells the right passphrase from a wrong one', async () => {
    const notSaved = await addPhrase(PASSPHRASE)
    const saved = await addPhrase(OTHER_PASSPHRASE, true)
    const standard = await addPhrase()

    expect(await keystoreCtrl.isSeedPassphraseCorrect(notSaved, PASSPHRASE)).toBe(true)
    expect(await keystoreCtrl.isSeedPassphraseCorrect(notSaved, OTHER_PASSPHRASE)).toBe(false)
    expect(await keystoreCtrl.isSeedPassphraseCorrect(notSaved, '')).toBe(false)
    expect(await keystoreCtrl.isSeedPassphraseCorrect(notSaved, null)).toBe(false)
    expect(await keystoreCtrl.isSeedPassphraseCorrect(saved, OTHER_PASSPHRASE)).toBe(true)
    expect(await keystoreCtrl.isSeedPassphraseCorrect(saved, PASSPHRASE)).toBe(false)
    expect(await keystoreCtrl.isSeedPassphraseCorrect(standard, null)).toBe(true)
    expect(await keystoreCtrl.isSeedPassphraseCorrect(standard, PASSPHRASE)).toBe(false)
  })

  test('saves a passphrase later only if it is the one the phrase was added with', async () => {
    const seedId = await addPhrase(PASSPHRASE)

    await expect(keystoreCtrl.saveSeedPassphrase(seedId, OTHER_PASSPHRASE)).rejects.toThrow(
      'not the passphrase the phrase was added with'
    )
    expect(seedById(seedId).isPassphraseSaved).toBe(false)

    await keystoreCtrl.saveSeedPassphrase(seedId, PASSPHRASE)

    expect(seedById(seedId).isPassphraseSaved).toBe(true)
    expect((await keystoreCtrl.getSavedSeed(seedId)).seedPassphrase).toBe(PASSPHRASE)
  })

  test('keeps the Privacy Pools key of a passphrase that is not saved only once asked, across locks', async () => {
    const seedId = await addPhrase(PASSPHRASE)
    const expectedKey = ethers.HDNodeWallet.fromMnemonic(
      ethers.Mnemonic.fromPhrase(process.env.SEED, PASSPHRASE),
      PRIVACY_POOLS_SIGNING_KEY_PATH
    ).privateKey

    // Nothing is derived on adding the phrase, only on adding its Privacy Pools account
    await expect(
      keystoreCtrl.derivePrivacyPoolsKey(seedId, PRIVACY_POOLS_SIGNING_KEY_PATH)
    ).rejects.toThrow('the passphrase is not saved and no Privacy Pools key is stored')
    await expect(keystoreCtrl.storePrivacyPoolsKey(seedId, OTHER_PASSPHRASE)).rejects.toThrow(
      'not the passphrase the phrase was added with'
    )

    await keystoreCtrl.storePrivacyPoolsKey(seedId, PASSPHRASE)

    expect(seedById(seedId).isPassphraseSaved).toBe(false)
    expect(await keystoreCtrl.derivePrivacyPoolsKey(seedId, PRIVACY_POOLS_SIGNING_KEY_PATH)).toBe(
      expectedKey
    )

    keystoreCtrl.lock()
    await keystoreCtrl.unlockWithSecret('password', pass)

    expect(await keystoreCtrl.derivePrivacyPoolsKey(seedId, PRIVACY_POOLS_SIGNING_KEY_PATH)).toBe(
      expectedKey
    )
    // The path check still guards the stored key
    await expect(keystoreCtrl.derivePrivacyPoolsKey(seedId, "m/44'/60'/0'/0/0")).rejects.toThrow(
      "refusing to derive a key outside Privacy Pools' paths"
    )
  })

  test('removes the stored Privacy Pools key, keeping the phrase', async () => {
    const seedId = await addPhrase(PASSPHRASE)
    const otherSeedId = await addPhrase(OTHER_PASSPHRASE)
    await keystoreCtrl.storePrivacyPoolsKey(seedId, PASSPHRASE)
    await keystoreCtrl.storePrivacyPoolsKey(otherSeedId, OTHER_PASSPHRASE)

    await keystoreCtrl.removePrivacyPoolsKey(seedId)
    keystoreCtrl.lock()
    await keystoreCtrl.unlockWithSecret('password', pass)

    await expect(
      keystoreCtrl.derivePrivacyPoolsKey(seedId, PRIVACY_POOLS_SIGNING_KEY_PATH)
    ).rejects.toThrow('no Privacy Pools key is stored')
    expect(seedById(seedId)).toMatchObject({ withPassphrase: true, isPassphraseSaved: false })
    // Only that phrase's key is removed
    expect(
      await keystoreCtrl.derivePrivacyPoolsKey(otherSeedId, PRIVACY_POOLS_SIGNING_KEY_PATH)
    ).toBe(
      ethers.HDNodeWallet.fromMnemonic(
        ethers.Mnemonic.fromPhrase(process.env.SEED, OTHER_PASSPHRASE),
        PRIVACY_POOLS_SIGNING_KEY_PATH
      ).privateKey
    )
    // A phrase without a stored key is left as it is
    await expect(keystoreCtrl.removePrivacyPoolsKey(seedId)).resolves.toBeUndefined()
  })

  test('links accounts to the entry of the passphrase they were derived with', async () => {
    const standard = await addPhrase()
    const notSaved = await addPhrase(PASSPHRASE)
    const saved = await addPhrase(OTHER_PASSPHRASE, true)

    const seedIdOf = async (passphrase?: string) =>
      (await keystoreCtrl.getKeystoreSeed(new KeyIterator(process.env.SEED, passphrase)))?.id

    expect(await seedIdOf()).toBe(standard)
    expect(await seedIdOf(PASSPHRASE)).toBe(notSaved)
    expect(await seedIdOf(OTHER_PASSPHRASE)).toBe(saved)
    expect(await seedIdOf('never added')).toBeUndefined()
  })

  test('numbers the passphrases saved before they had names, once unlocked', async () => {
    const standard = await addPhrase()
    const first = await addPhrase(PASSPHRASE, true)
    const second = await addPhrase(OTHER_PASSPHRASE, true)
    // As stored by an older version
    const storedSeeds = await storageCtrl.get('keystoreSeeds', [])
    await storageCtrl.set(
      'keystoreSeeds',
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      storedSeeds.map(({ passphraseLabel, passphraseFingerprint, ...seed }: any) => seed)
    )

    keystoreCtrl = new KeystoreController(
      'default',
      storageCtrl,
      keystoreSigners,
      new UiController({ uiManager })
    )
    await keystoreCtrl.unlockWithSecret('password', pass)

    expect(seedById(standard).passphraseLabel).toBeUndefined()
    expect(seedById(first)).toMatchObject({ withPassphrase: true, passphraseLabel: '1' })
    expect(seedById(second)).toMatchObject({ withPassphrase: true, passphraseLabel: '2' })
    // Still found by its passphrase, rather than added again
    expect(await addPhrase(PASSPHRASE)).toBe(first)
    expect(keystoreCtrl.seeds).toHaveLength(3)
  })
})

describe('KeystoreController signing authentication', () => {
  let keystoreCtrl: IKeystoreController

  beforeEach(async () => {
    const storageCtrl = new StorageController(produceMemoryStore())
    const uiCtrl = new UiController({ uiManager })
    keystoreCtrl = new KeystoreController('default', storageCtrl, keystoreSigners, uiCtrl)
    await keystoreCtrl.addSecret('password', pass, '', false)
    await keystoreCtrl.unlockWithSecret('password', pass)
  })

  test('the correct secret is confirmed and the keystore stays unlocked', async () => {
    await keystoreCtrl.verifySecret('password', pass)

    expect(keystoreCtrl.signingAuthResult).toMatchObject({ status: 'success', error: null })
    expect(keystoreCtrl.isUnlocked).toBe(true)
  })

  // Two in a row are otherwise deeply identical, and the UI's reconciled state hands an unchanged
  // result back as the same reference - so the screen never learns the second one happened
  test('a second confirmation is distinguishable from the one before it', async () => {
    await keystoreCtrl.verifySecret('password', pass)
    const first = keystoreCtrl.signingAuthResult

    await keystoreCtrl.verifySecret('password', pass)
    const second = keystoreCtrl.signingAuthResult

    expect(second?.status).toBe('success')
    expect(second?.id).not.toBe(first?.id)
  })

  describe('a wrong secret', () => {
    suppressConsoleBeforeEach()

    test('is rejected without locking the keystore', async () => {
      await keystoreCtrl.verifySecret('password', `${pass}1`)

      expect(keystoreCtrl.signingAuthResult?.status).toBe('failed')
      expect(keystoreCtrl.signingAuthResult?.error).toBe('Incorrect password. Please try again.')
      // A failed confirmation must never lock the user out of the session they are already in
      expect(keystoreCtrl.isUnlocked).toBe(true)
    })

    test('can be followed by the correct one', async () => {
      await keystoreCtrl.verifySecret('password', `${pass}1`)
      await keystoreCtrl.verifySecret('password', pass)

      expect(keystoreCtrl.signingAuthResult).toMatchObject({ status: 'success', error: null })
    })

    test('two failures in a row are distinguishable from each other', async () => {
      await keystoreCtrl.verifySecret('password', `${pass}1`)
      const first = keystoreCtrl.signingAuthResult

      await keystoreCtrl.verifySecret('password', `${pass}1`)
      const second = keystoreCtrl.signingAuthResult

      expect(second?.status).toBe('failed')
      expect(second?.id).not.toBe(first?.id)
    })

    test('is rejected when the secret does not exist at all', async () => {
      await keystoreCtrl.verifySecret('biometrics', pass)

      expect(keystoreCtrl.signingAuthResult?.status).toBe('failed')
      expect(keystoreCtrl.isUnlocked).toBe(true)
    })
  })

  // The web throws a DOMException named OperationError, native WebCrypto throws whatever its
  // cipher raised with no name to go by - what the cipher rejected with must not matter
  describe('the cipher rejecting is a wrong secret whatever it threw', () => {
    suppressConsoleBeforeEach()

    test.each([
      [
        'a named DOMException',
        Object.assign(new Error('decrypt failed'), { name: 'OperationError' })
      ],
      ['nothing to go by', new Error('CipherJob failed')]
    ])('the platform throws %s', async (_, thrown) => {
      const decryptSpy = jest.spyOn(crypto.subtle, 'decrypt').mockRejectedValue(thrown)

      await keystoreCtrl.verifySecret('password', pass)

      expect(keystoreCtrl.signingAuthResult?.status).toBe('failed')
      expect(keystoreCtrl.signingAuthResult?.error).toBe('Incorrect password. Please try again.')

      decryptSpy.mockRestore()
    })
  })

  // Telling the user their password is wrong when the platform is what broke leaves them
  // retrying a password that was right all along
  describe('a platform failure is not reported as a wrong secret', () => {
    suppressConsoleBeforeEach()

    test('unlocking says something went wrong instead', async () => {
      const importKeySpy = jest
        .spyOn(crypto.subtle, 'importKey')
        .mockRejectedValue(new Error('WebCrypto is unavailable'))

      await keystoreCtrl.unlockWithSecret('password', pass)

      expect(keystoreCtrl.errorMessage).not.toBe('Incorrect password. Please try again.')

      importKeySpy.mockRestore()
    })
  })

  describe('a verification leaves the unlock error alone', () => {
    suppressConsoleBeforeEach()

    // The two share `errorMessage`, so a failed fingerprint used to put "Incorrect password" on
    // the password field of the screen behind it
    test('a wrong secret is reported only through the result', async () => {
      await keystoreCtrl.verifySecret('password', `${pass}1`)

      expect(keystoreCtrl.signingAuthResult?.error).toBe('Incorrect password. Please try again.')
      expect(keystoreCtrl.errorMessage).toBe('')
    })

    // Resetting used to clear `errorMessage` too, so opening a confirmation wiped an error the
    // user had not read yet. A confirmation that actually passes still clears it, as it should.
    test('resetting the result leaves an error the user has not read yet', async () => {
      await keystoreCtrl.unlockWithSecret('password', `${pass}1`)
      expect(keystoreCtrl.errorMessage).toBe('Incorrect password. Please try again.')

      keystoreCtrl.resetSigningAuthResult()

      expect(keystoreCtrl.errorMessage).toBe('Incorrect password. Please try again.')
    })
  })

  test('resetSigningAuthResult clears the outcome', async () => {
    await keystoreCtrl.verifySecret('password', pass)
    keystoreCtrl.resetSigningAuthResult()

    expect(keystoreCtrl.signingAuthResult).toBe(null)
  })
})

describe('import/export with pub key test', () => {
  const wallet = ethers.Wallet.createRandom()
  let keystore2: IKeystoreController
  let uid2: string

  beforeEach(async () => {
    const storage = produceMemoryStore()
    const storage2 = produceMemoryStore()
    const storageCtrl = new StorageController(storage)
    const storageCtrl2 = new StorageController(storage2)
    const uiCtrl = new UiController({ uiManager })

    keystore = new KeystoreController('default', storageCtrl, keystoreSigners, uiCtrl)
    keystore2 = new KeystoreController('default', storageCtrl2, keystoreSigners, uiCtrl)

    await keystore2.addSecret('123', '123', '', false)
    await keystore2.unlockWithSecret('123', '123')
    uid2 = await keystore2.getKeyStoreUid()

    await keystore.addSecret('a', 'b', '', false)
    await keystore.unlockWithSecret('a', 'b')
  })

  test('import Key With Public Key Encryption', async () => {
    await keystore.addKeys([
      {
        addr: wallet.address,
        label: 'Key 1',
        type: 'internal',
        privateKey: wallet.privateKey.slice(2),
        dedicatedToOneSA: false,
        meta: { createdAt: new Date().getTime() }
      }
    ])

    expect(keystore.keys[0]).toMatchObject({ addr: wallet.address, type: 'internal' })

    const exported = await keystore.exportKeyWithPublicKeyEncryption(wallet.address, uid2)
    await keystore2.importKeyWithPublicKeyEncryption(exported, true)

    const signer = await keystore2.getSigner(wallet.address, 'internal')
    expect(signer.key).toEqual(
      expect.objectContaining({
        addr: wallet.address,
        isExternallyStored: false,
        label: 'Key 1',
        type: 'internal'
      })
    )
  })
})

describe('app data sync between two devices', () => {
  const EXTERNAL_ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
  const exportingPass = 'exportingDevicePass'
  const importingPass = 'importingDevicePass'

  let exportingKeystore: IKeystoreController
  let importingKeystore: IKeystoreController
  let exportedSeedId: string

  const uiCtrl = new UiController({ uiManager })

  const createKeystore = () =>
    new KeystoreController(
      'default',
      new StorageController(produceMemoryStore()),
      keystoreSigners,
      uiCtrl
    )

  // The in-memory store resolves writes immediately, which hides ordering a real
  // (async) device store would expose
  const withSlowWrites = (store: ReturnType<typeof produceMemoryStore>) => ({
    ...store,
    set: async (key: any, value: any) => {
      await wait(10)

      return store.set(key, value)
    }
  })

  const buildPayload = (keyAddrs: string[]) =>
    exportingKeystore
      .exportForSync(keyAddrs)
      .then((exported) => ({ v: 1 as const, accounts: [], ...exported }))

  beforeEach(async () => {
    exportingKeystore = createKeystore()
    await exportingKeystore.addSecret('password', exportingPass, '', false)
    await exportingKeystore.unlockWithSecret('password', exportingPass)

    await exportingKeystore.addTempSeed({
      seed: process.env.SEED,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    await exportingKeystore.persistTempSeed()
    exportedSeedId = exportingKeystore.seeds[0]!.id

    await exportingKeystore.addKeys([
      {
        addr: keyPublicAddress,
        label: 'Key 1',
        type: 'internal',
        privateKey: privKey,
        dedicatedToOneSA: false,
        meta: { createdAt: new Date().getTime(), fromSeedId: exportedSeedId }
      }
    ])
    await exportingKeystore.addKeysExternallyStored([
      {
        addr: EXTERNAL_ADDR,
        label: 'Ledger Key 1',
        type: 'ledger',
        dedicatedToOneSA: false,
        meta: {
          deviceId: '1',
          deviceModel: 'nanoX',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          index: 1,
          createdAt: new Date().getTime()
        }
      }
    ])

    importingKeystore = createKeystore()
  })

  test('exports the selected keys, their seed and the password wrapped main key', async () => {
    const exported = await exportingKeystore.exportForSync([keyPublicAddress])

    expect(exported.secret.id).toBe('password')
    expect(exported.secret.aesEncrypted.cipherType).toBe('AES-GCM')
    // The private key must leave the device encrypted, exactly as it is stored
    expect(exported.keys).toHaveLength(1)
    expect(exported.keys[0]!.addr).toBe(keyPublicAddress)
    expect(exported.keys[0]!.privKey).toMatchObject({ cipherType: 'AES-GCM' })
    expect(JSON.stringify(exported)).not.toContain(privKey)
    // Only the seed the exported key was derived from
    expect(exported.seeds.map((s) => s.id)).toEqual([exportedSeedId])
  })

  test('does not export keys that were not selected', async () => {
    const exported = await exportingKeystore.exportForSync([EXTERNAL_ADDR])

    expect(exported.keys.map((k) => k.addr)).toEqual([EXTERNAL_ADDR])
    expect(exported.seeds).toHaveLength(0)
  })

  test('leaves the seed behind when the user opted out of exporting it', async () => {
    const exported = await exportingKeystore.exportForSync([keyPublicAddress], false)

    expect(exported.keys.map((k) => k.addr)).toEqual([keyPublicAddress])
    expect(exported.seeds).toHaveLength(0)

    // The key still signs on the other device, it is just no longer tied to a seed
    await importingKeystore.addSecret('password', importingPass, '', true)
    await importingKeystore.importFromSync(
      { v: 1 as const, accounts: [], ...exported },
      exportingPass
    )

    expect(importingKeystore.seeds).toHaveLength(0)
    expect(importingKeystore.keys[0]!.meta.fromSeedId).toBeUndefined()
  })

  test('exports the main key even when nothing needs decrypting, so the password gets confirmed', async () => {
    const hardwareWalletOnly = await exportingKeystore.exportForSync([EXTERNAL_ADDR])
    const nothingEncrypted = await exportingKeystore.exportForSync([])

    expect(hardwareWalletOnly.secret.id).toBe('password')
    expect(nothingEncrypted.secret.id).toBe('password')
  })

  test('imports hardware wallet keys with the password of the other device', async () => {
    await importingKeystore.addSecret('password', importingPass, '', true)
    const payload = await buildPayload([EXTERNAL_ADDR])

    await importingKeystore.importFromSync(payload, exportingPass)

    expect(importingKeystore.keys).toEqual([
      expect.objectContaining({ addr: EXTERNAL_ADDR, type: 'ledger', isExternallyStored: true })
    ])
  })

  describe('a phrase added with a passphrase', () => {
    const PASSPHRASE = 'extra word'
    const passphraseKey = stripHexPrefix(
      getPrivateKeyFromSeed(process.env.SEED, PASSPHRASE, 0, BIP44_STANDARD_DERIVATION_TEMPLATE)
    )
    const passphraseKeyAddr = new ethers.Wallet(passphraseKey).address

    const addPassphrasePhraseWithKey = async (shouldSavePassphrase: boolean) => {
      await exportingKeystore.addTempSeed({
        seed: process.env.SEED,
        seedPassphrase: PASSPHRASE,
        shouldSavePassphrase,
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
      })
      await exportingKeystore.persistTempSeed()
      const seedId = exportingKeystore.seeds.at(-1)!.id
      await exportingKeystore.addKeys([
        {
          addr: passphraseKeyAddr,
          label: 'Key 2',
          type: 'internal',
          privateKey: passphraseKey,
          dedicatedToOneSA: false,
          meta: { createdAt: new Date().getTime(), fromSeedId: seedId }
        }
      ])

      return seedId
    }

    test('arrives without its passphrase or Privacy Pools key when the passphrase is not saved', async () => {
      const seedId = await addPassphrasePhraseWithKey(false)
      await exportingKeystore.storePrivacyPoolsKey(seedId, PASSPHRASE)
      await importingKeystore.addSecret('password', importingPass, '', true)

      const payload = await buildPayload([passphraseKeyAddr])
      await importingKeystore.importFromSync(payload, exportingPass)

      expect(payload.seeds[0]).not.toHaveProperty('privacyPoolsSigningKey')
      expect(importingKeystore.seeds).toEqual([
        expect.objectContaining({ id: seedId, withPassphrase: true, isPassphraseSaved: false })
      ])
      expect(importingKeystore.keys[0]!.meta.fromSeedId).toBe(seedId)
      const syncedSeed = await importingKeystore.getSavedSeed(seedId)
      expect(syncedSeed.seedPassphrase).toBeNull()
      expect(await importingKeystore.isSeedPassphraseCorrect(seedId, PASSPHRASE)).toBe(true)
      await expect(
        importingKeystore.derivePrivacyPoolsKey(seedId, PRIVACY_POOLS_SIGNING_KEY_PATH)
      ).rejects.toThrow('no Privacy Pools key is stored')
    })

    test('adds no Privacy Pools key to a phrase this device already has', async () => {
      const seedId = await addPassphrasePhraseWithKey(false)
      await exportingKeystore.storePrivacyPoolsKey(seedId, PASSPHRASE)
      await importingKeystore.addSecret('password', importingPass, '', true)
      await importingKeystore.addTempSeed({
        seed: process.env.SEED,
        seedPassphrase: PASSPHRASE,
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
      })
      await importingKeystore.persistTempSeed()
      const existingSeedId = importingKeystore.seeds[0]!.id

      await importingKeystore.importFromSync(await buildPayload([passphraseKeyAddr]), exportingPass)

      expect(importingKeystore.seeds).toHaveLength(1)
      await expect(
        importingKeystore.derivePrivacyPoolsKey(existingSeedId, PRIVACY_POOLS_SIGNING_KEY_PATH)
      ).rejects.toThrow('no Privacy Pools key is stored')
    })

    test('stays saved when it was saved on the other device', async () => {
      const seedId = await addPassphrasePhraseWithKey(true)
      await importingKeystore.addSecret('password', importingPass, '', true)

      await importingKeystore.importFromSync(await buildPayload([passphraseKeyAddr]), exportingPass)

      expect(importingKeystore.seeds[0]).toMatchObject({ id: seedId, isPassphraseSaved: true })
      expect((await importingKeystore.getSavedSeed(seedId)).seedPassphrase).toBe(PASSPHRASE)
    })

    test('is queued with its fingerprint when synced before the device password is set', async () => {
      const seedId = await addPassphrasePhraseWithKey(false)

      await importingKeystore.importFromSync(await buildPayload([passphraseKeyAddr]), exportingPass)
      await importingKeystore.addSecret('password', importingPass, '', true)

      expect(importingKeystore.seeds[0]).toMatchObject({ id: seedId, withPassphrase: true })
      expect(await importingKeystore.isSeedPassphraseCorrect(seedId, PASSPHRASE)).toBe(true)
    })
  })

  describe('Negative cases', () => {
    suppressConsoleBeforeEach()

    test('does not import hardware wallet keys when the password of the other device is wrong', async () => {
      await importingKeystore.addSecret('password', importingPass, '', true)
      const payload = await buildPayload([EXTERNAL_ADDR])

      await expect(importingKeystore.importFromSync(payload, 'wrongPass')).rejects.toThrow(
        'Incorrect password. Please try again.'
      )
      expect(importingKeystore.keys).toHaveLength(0)
    })

    test('refuses to export even hardware wallet keys from a device without a password', async () => {
      const biometricsOnlyKeystore = createKeystore()
      await biometricsOnlyKeystore.addSecret('biometrics', 'biometricsSecret', '', true)

      await expect(biometricsOnlyKeystore.exportForSync([])).rejects.toThrow(
        'Set a password for this device before syncing your accounts.'
      )
    })

    test('refuses to export private keys from a device without a password', async () => {
      const biometricsOnlyKeystore = createKeystore()
      await biometricsOnlyKeystore.addSecret('biometrics', 'biometricsSecret', '', true)
      await biometricsOnlyKeystore.addKeys([
        {
          addr: keyPublicAddress,
          label: 'Key 1',
          type: 'internal',
          privateKey: privKey,
          dedicatedToOneSA: false,
          meta: { createdAt: new Date().getTime() }
        }
      ])

      await expect(biometricsOnlyKeystore.exportForSync([keyPublicAddress])).rejects.toThrow(
        'Set a password for this device before syncing your accounts.'
      )
    })

    test('does not import anything when the password of the other device is wrong', async () => {
      await importingKeystore.addSecret('password', importingPass, '', true)
      const payload = await buildPayload([keyPublicAddress])

      await expect(importingKeystore.importFromSync(payload, 'wrongPass')).rejects.toThrow(
        'Incorrect password. Please try again.'
      )
      expect(importingKeystore.keys).toHaveLength(0)
      expect(importingKeystore.seeds).toHaveLength(0)
    })
  })

  test('imports keys and seeds into a device that already has a password', async () => {
    await importingKeystore.addSecret('password', importingPass, '', true)
    const payload = await buildPayload([keyPublicAddress, EXTERNAL_ADDR])

    await importingKeystore.importFromSync(payload, exportingPass)

    expect(importingKeystore.keys).toHaveLength(2)
    expect(importingKeystore.keys).toContainEqual(
      expect.objectContaining({ addr: EXTERNAL_ADDR, type: 'ledger', isExternallyStored: true })
    )
    // The key is re-encrypted with the importing device's main key, so it can sign
    const signer = await importingKeystore.getSigner(keyPublicAddress, 'internal')
    expect(signer.key.addr).toBe(keyPublicAddress)

    // The seed comes along and the key keeps pointing to it
    expect(importingKeystore.seeds.map((s) => s.id)).toEqual([exportedSeedId])
    expect(importingKeystore.keys.find((k) => k.type === 'internal')?.meta.fromSeedId).toBe(
      exportedSeedId
    )
    expect((await importingKeystore.getSavedSeed(exportedSeedId)).seed).toBe(process.env.SEED)
  })

  test('imports before the device password is set (onboarding) and stores everything once it is', async () => {
    const payload = await buildPayload([keyPublicAddress, EXTERNAL_ADDR])

    await importingKeystore.importFromSync(payload, exportingPass)

    // Nothing can be stored yet, as there is no main key to encrypt with
    expect(importingKeystore.keys).toHaveLength(0)
    expect(importingKeystore.seeds).toHaveLength(0)

    await importingKeystore.addSecret('password', importingPass, '', true)

    expect(importingKeystore.keys).toHaveLength(2)
    expect(importingKeystore.seeds.map((s) => s.id)).toEqual([exportedSeedId])
    expect(importingKeystore.keys.find((k) => k.type === 'internal')?.meta.fromSeedId).toBe(
      exportedSeedId
    )
    const signer = await importingKeystore.getSigner(keyPublicAddress, 'internal')
    expect(signer.key.addr).toBe(keyPublicAddress)
  })

  test('tells the UI about the synced keys right after the import', async () => {
    const payload = await buildPayload([keyPublicAddress, EXTERNAL_ADDR])
    await importingKeystore.addSecret('password', importingPass, '', true)

    // Without an update the UI keeps the keystore state it had before the sync, which
    // makes every imported account look view-only
    const keyCountsSeenByTheUi: number[] = []
    importingKeystore.onUpdate(() => keyCountsSeenByTheUi.push(importingKeystore.keys.length))

    await importingKeystore.importFromSync(payload, exportingPass)

    expect(importingKeystore.keys).toHaveLength(2)
    expect(keyCountsSeenByTheUi.at(-1)).toBe(2)
  })

  test('tells the UI about the synced keys once the onboarding password stores them', async () => {
    const payload = await buildPayload([keyPublicAddress, EXTERNAL_ADDR])
    // On a real device writes take a moment, so this guards that `addSecret` waits for the
    // queued keys to be stored and emits afterwards. Without that update the UI keeps
    // rendering the synced accounts as if they had no keys.
    const slowKeystore = new KeystoreController(
      'default',
      new StorageController(withSlowWrites(produceMemoryStore())),
      keystoreSigners,
      uiCtrl
    )
    await slowKeystore.importFromSync(payload, exportingPass)

    const keyCountsSeenByTheUi: number[] = []
    slowKeystore.onUpdate(() => keyCountsSeenByTheUi.push(slowKeystore.keys.length))

    await slowKeystore.addSecret('password', importingPass, '', true)

    expect(slowKeystore.keys).toHaveLength(2)
    expect(keyCountsSeenByTheUi.at(-1)).toBe(2)
  })

  test('links the synced keys to a seed the device already has', async () => {
    await importingKeystore.addSecret('password', importingPass, '', true)
    // The very same recovery phrase was already imported on this device, under an id of
    // its own, so the synced keys have to be linked to that one
    await importingKeystore.addTempSeed({
      seed: process.env.SEED,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    await importingKeystore.persistTempSeed()
    const alreadyStoredSeedId = importingKeystore.seeds[0]!.id

    await importingKeystore.importFromSync(await buildPayload([keyPublicAddress]), exportingPass)

    expect(importingKeystore.seeds).toHaveLength(1)
    expect(importingKeystore.seeds[0]!.id).toBe(alreadyStoredSeedId)
    expect(importingKeystore.keys.find((k) => k.type === 'internal')?.meta.fromSeedId).toBe(
      alreadyStoredSeedId
    )
  })

  test('syncing the same accounts twice does not duplicate keys or seeds', async () => {
    await importingKeystore.addSecret('password', importingPass, '', true)
    const payload = await buildPayload([keyPublicAddress, EXTERNAL_ADDR])

    await importingKeystore.importFromSync(payload, exportingPass)
    await importingKeystore.importFromSync(payload, exportingPass)

    expect(importingKeystore.keys).toHaveLength(2)
    expect(importingKeystore.seeds).toHaveLength(1)
  })
})

describe('KeystoreController fee payer key', () => {
  const accountAddr = '0x0000000000000000000000000000000000000001'
  const hardwareOnlyAddr = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
  let keystoreCtrl: IKeystoreController

  const externalKey = (addr: string, type: 'trezor' | 'ledger'): ExternalKey => ({
    addr,
    type,
    dedicatedToOneSA: false,
    label: `${type} key`,
    meta: {
      deviceId: '1',
      deviceModel: type,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      index: 1,
      createdAt: new Date().getTime()
    }
  })

  beforeEach(async () => {
    const storageCtrl = new StorageController(produceMemoryStore())
    const uiCtrl = new UiController({ uiManager })
    keystoreCtrl = new KeystoreController('default', storageCtrl, keystoreSigners, uiCtrl)
    await keystoreCtrl.addSecret('password', pass, '', false)
    await keystoreCtrl.unlockWithSecret('password', pass)
    // The hardware wallet keys are added first, so the private key is not the first one stored
    await keystoreCtrl.addKeysExternallyStored([
      externalKey(keyPublicAddress, 'trezor'),
      externalKey(keyPublicAddress, 'ledger'),
      externalKey(hardwareOnlyAddr, 'trezor'),
      externalKey(hardwareOnlyAddr, 'ledger')
    ])
    await keystoreCtrl.addKeys([
      {
        addr: keyPublicAddress,
        label: 'Key 1',
        type: 'internal',
        privateKey: privKey,
        dedicatedToOneSA: true,
        meta: { createdAt: new Date().getTime() }
      }
    ])
  })

  test('defaults to the private key, even when it was added after the other keys', () => {
    const key = keystoreCtrl.getFeePayerKey(accountAddr, keyPublicAddress)

    expect(key).not.toBeInstanceOf(Error)
    expect(key).toEqual(expect.objectContaining({ addr: keyPublicAddress, type: 'internal' }))
  })

  test('returns the kind of key asked for over the private key', () => {
    const key = keystoreCtrl.getFeePayerKey(accountAddr, keyPublicAddress, 'ledger')

    expect(key).toEqual(expect.objectContaining({ addr: keyPublicAddress, type: 'ledger' }))
  })

  test('falls back to the private key when the kind asked for is not stored', () => {
    const key = keystoreCtrl.getFeePayerKey(accountAddr, keyPublicAddress, 'lattice')

    expect(key).toEqual(expect.objectContaining({ addr: keyPublicAddress, type: 'internal' }))
  })

  test('defaults to the first key stored when there is no private key', () => {
    const key = keystoreCtrl.getFeePayerKey(accountAddr, hardwareOnlyAddr)

    expect(key).toEqual(expect.objectContaining({ addr: hardwareOnlyAddr, type: 'trezor' }))
  })

  test('returns an error when no key for the address is stored', () => {
    const key = keystoreCtrl.getFeePayerKey(
      accountAddr,
      '0x0000000000000000000000000000000000000002'
    )

    expect(key).toBeInstanceOf(Error)
  })
})
