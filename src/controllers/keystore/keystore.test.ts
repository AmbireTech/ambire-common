/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
/* eslint-disable max-classes-per-file */

import { ethers, hexlify, randomBytes, Wallet } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { mockUiManager } from '../../../test/helpers/ui'
import {
  BIP44_STANDARD_DERIVATION_TEMPLATE,
  LEGACY_POPULAR_DERIVATION_TEMPLATE
} from '../../consts/derivation'
import { Hex } from '../../interfaces/hex'
import {
  ExternalKey,
  IKeystoreController,
  InternalKey,
  Key,
  KeystoreSignerInterface
} from '../../interfaces/keystore'
import { getPrivateKeyFromSeed } from '../../libs/keyIterator/keyIterator'
import { stripHexPrefix } from '../../utils/stripHexPrefix'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { KeystoreController } from './keystore'

class InternalSigner {
  key

  privKey

  constructor(_key: Key, _privKey?: string) {
    this.key = _key
    this.privKey = _privKey
  }

  signRawTransaction() {
    return Promise.resolve('')
  }

  signTypedData() {
    return Promise.resolve('')
  }

  signMessage() {
    return Promise.resolve('')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sign7702: KeystoreSignerInterface['sign7702'] = async (s) => {
    return {
      yParity: '0x00',
      r: hexlify(randomBytes(32)) as Hex,
      s: hexlify(randomBytes(32)) as Hex
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  signTransactionTypeFour: KeystoreSignerInterface['signTransactionTypeFour'] = async (s) => {
    throw new Error('not supported')
  }
}

class LedgerSigner {
  key

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(_key: Key) {
    this.key = _key
  }

  signRawTransaction() {
    return Promise.resolve('')
  }

  signTypedData() {
    return Promise.resolve('')
  }

  signMessage() {
    return Promise.resolve('')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sign7702: KeystoreSignerInterface['sign7702'] = async (s) => {
    return {
      yParity: '0x00',
      r: hexlify(randomBytes(32)) as Hex,
      s: hexlify(randomBytes(32)) as Hex
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  signTransactionTypeFour: KeystoreSignerInterface['signTransactionTypeFour'] = async (s) => {
    throw new Error('not supported')
  }
}

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

  describe('Negative cases', () => {
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

  describe('Negative cases', () => {
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
        type: 'internal' as 'internal',
        privateKey: privKey,
        dedicatedToOneSA: false,
        meta: {
          createdAt: new Date().getTime()
        }
      },
      {
        addr: new Wallet(privKey).address,
        label: 'Key 2',
        type: 'internal' as 'internal',
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
        type: 'internal' as 'internal',
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
        type: 'internal' as 'internal',
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
        type: 'trezor' as 'trezor',
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
        type: 'trezor' as 'trezor',
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
        type: 'trezor' as 'trezor',
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
        type: 'trezor' as 'trezor',
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
        type: 'trezor' as 'trezor',
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
        type: 'trezor' as 'trezor',
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
        type: 'ledger' as 'ledger',
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

  describe('Negative cases', () => {
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
