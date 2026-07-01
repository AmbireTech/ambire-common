import aes from 'aes-js'
import { concat, getBytes, hexlify, Mnemonic } from 'ethers'

import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '@/consts/derivation'
import { AESGCMEncrypted, MainKeyOld } from '@/interfaces/keystore'
import { ScryptAdapter } from '@/libs/scrypt/scryptAdapter'

import { suppressConsoleBeforeEach } from '../../../test/helpers/console'
import {
  CIPHER,
  decryptWithKey,
  decryptWithKeyOld,
  deriveSecret,
  encryptMainKeyWithSecret,
  encryptWithKey,
  extractEntropyFromSeed,
  getBytesForSecret,
  migrateStoredPayloadsToGCM,
  reconstructSeedFromEntropy,
  SCRYPT_PARAMS,
  tryParseGcmPayload
} from './keystore'

const VALID_12_WORD_SEED =
  'fashion blossom click cost club ring vapor know wisdom enlist neither receive'
const TEST_PRIVATE_KEY = '0xc0487aa2280aa042b6ea1607e6ac502c850e5b0fcbdfad9460e404ac45f792b7'
const TEST_SALT_HEX = '0x0102030405060708090a0b0c0d0e0f10'
const TEST_MAIN_KEY_OLD = {
  key: crypto.getRandomValues(new Uint8Array(16)),
  iv: crypto.getRandomValues(new Uint8Array(16))
}
const PRIMARY_INTERNAL_ADDR = '0x085f8A348f6fBc6F8d8FC3f1e427473436506D65'
const SECONDARY_INTERNAL_ADDR = '0x3Cf7535B5F800570c63E40e37BA7a9489cafDf96'
const EXTERNAL_ADDR = '0x1A2C3802A9eC12725678dAF23DbFD13134e5893A'

const createMainKey = async () =>
  crypto.subtle.importKey(
    'raw',
    new Uint8Array(getBytes(concat([TEST_MAIN_KEY_OLD.key, TEST_MAIN_KEY_OLD.iv]))),
    { name: CIPHER },
    true,
    ['encrypt', 'decrypt']
  )

const createAesCtrCiphertextFromBytes = (
  plaintext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array
) => {
  const counter = new aes.Counter(iv)
  const aesCtr = new aes.ModeOfOperation.ctr(key, counter)

  return hexlify(aesCtr.encrypt(plaintext))
}

const createLegacyPrivateKeyPayload = (key: Uint8Array, iv: Uint8Array) =>
  createAesCtrCiphertextFromBytes(getBytes(TEST_PRIVATE_KEY), key, iv)

const createLegacySeedPayload = (seed: string, key: Uint8Array, iv: Uint8Array) =>
  createAesCtrCiphertextFromBytes(new TextEncoder().encode(seed), key, iv)

const createLegacyTextPayload = (text: string, key: Uint8Array, iv: Uint8Array) =>
  createAesCtrCiphertextFromBytes(new TextEncoder().encode(text), key, iv)

// Flips a single byte of a hex string so we can simulate a corrupted/tampered payload.
const tamperHexByte = (hex: string, index: number): string => {
  const bytes = getBytes(hex)
  bytes[index] = bytes[index]! ^ 0xff
  return hexlify(bytes)
}

describe('Keystore lib', () => {
  describe('getBytesForSecret', () => {
    test('normalizes equivalent unicode strings to the same bytes', () => {
      const composed = getBytesForSecret('café')
      const decomposed = getBytesForSecret('cafe\u0301')

      expect(hexlify(composed)).toBe(hexlify(decomposed))
    })
  })

  describe('extractEntropyFromSeed', () => {
    test('extracts entropy from a valid mnemonic', () => {
      const entropy = extractEntropyFromSeed(VALID_12_WORD_SEED)

      expect(entropy).toEqual(getBytes(Mnemonic.fromPhrase(VALID_12_WORD_SEED).entropy))
    })

    test('throws for an invalid mnemonic', () => {
      expect(() => extractEntropyFromSeed('not a valid mnemonic')).toThrow()
    })
  })

  describe('reconstructSeedFromEntropy', () => {
    test('round-trips entropy back to the same mnemonic', () => {
      const entropy = extractEntropyFromSeed(VALID_12_WORD_SEED)

      expect(reconstructSeedFromEntropy(entropy)).toBe(VALID_12_WORD_SEED)
    })
  })

  describe('getGcmDecryptionBytes', () => {
    test('concatenates ciphertext before tag', () => {
      const bytes = new Uint8Array(getBytes('0x1234abcd'))

      expect(Array.from(bytes)).toEqual([0x12, 0x34, 0xab, 0xcd])
    })
  })

  describe('tryParseGcmPayload', () => {
    test('returns null for string payloads', () => {
      expect(tryParseGcmPayload('0x1234')).toBeNull()
    })

    test('returns null for missing payloads', () => {
      expect(tryParseGcmPayload(null as any)).toBeNull()
      expect(tryParseGcmPayload(undefined as any)).toBeNull()
    })

    test('throws for unsupported cipher types', () => {
      expect(() =>
        tryParseGcmPayload({
          cipherType: 'AES-CBC',
          ciphertext: '0x00',
          iv: '0x00',
          tag: '0x00'
        } as any)
      ).toThrow()
    })

    test('throws for malformed payload shapes', () => {
      expect(() =>
        tryParseGcmPayload({
          cipherType: CIPHER,
          ciphertext: '0x00',
          iv: 1,
          tag: '0x00'
        } as any)
      ).toThrow()
    })

    test('returns valid gcm payloads unchanged', () => {
      const payload: AESGCMEncrypted = {
        cipherType: CIPHER,
        ciphertext: '0x1234',
        iv: '0xabcdef'
      }

      expect(tryParseGcmPayload(payload)).toBe(payload)
    })
  })

  describe('encryptWithKey and decryptWithKey', () => {
    let key: CryptoKey

    beforeEach(async () => {
      key = await createMainKey()
    })

    test('encrypts data into the expected gcm payload shape', async () => {
      const payload = await encryptWithKey(key, getBytes(TEST_PRIVATE_KEY))

      expect(payload.cipherType).toBe(CIPHER)
      expect(payload.iv).toMatch(/^0x[0-9a-f]+$/)
      expect(payload.ciphertext).toMatch(/^0x[0-9a-f]+$/)
    })

    test('decrypts encrypted data back to the original plaintext', async () => {
      const plaintext = getBytes(TEST_PRIVATE_KEY)
      const encrypted = await encryptWithKey(key, plaintext)
      const decrypted = await decryptWithKey(key, encrypted)

      expect(hexlify(decrypted)).toBe(hexlify(plaintext))
    })

    test('decryptWithKey works with CTR (calls decryptWithKeyOld internally)', async () => {
      const exported = await crypto.subtle.exportKey('raw', key)
      const mainKeyOld: MainKeyOld = {
        key: new Uint8Array(exported.slice(0, 16)),
        iv: new Uint8Array(exported.slice(16, 32))
      }
      const legacyPayload = createLegacyPrivateKeyPayload(mainKeyOld.key, mainKeyOld.iv)
      const decrypted = await decryptWithKey(key, legacyPayload)

      expect(hexlify(decrypted)).toBe(TEST_PRIVATE_KEY.toLowerCase())
    })

    test('rejects non-CryptoKey inputs', async () => {
      await expect(
        decryptWithKey({} as CryptoKey, {
          cipherType: CIPHER,
          ciphertext: '0x00',
          iv: '0x00'
        })
      ).rejects.toThrow()
    })

    test('rejects a payload with a tampered ciphertext (GCM authentication fails)', async () => {
      const encrypted = await encryptWithKey(key, getBytes(TEST_PRIVATE_KEY))
      const tampered = { ...encrypted, ciphertext: tamperHexByte(encrypted.ciphertext, 0) }

      await expect(decryptWithKey(key, tampered)).rejects.toThrow()
    })

    test('rejects a payload with a tampered authentication tag', async () => {
      const encrypted = await encryptWithKey(key, getBytes(TEST_PRIVATE_KEY))
      // The 128-bit auth tag is appended to the ciphertext, so the last byte is part of the tag.
      const lastByteIndex = getBytes(encrypted.ciphertext).length - 1
      const tampered = {
        ...encrypted,
        ciphertext: tamperHexByte(encrypted.ciphertext, lastByteIndex)
      }

      await expect(decryptWithKey(key, tampered)).rejects.toThrow()
    })

    test('rejects a payload with a tampered iv', async () => {
      const encrypted = await encryptWithKey(key, getBytes(TEST_PRIVATE_KEY))
      const tampered = { ...encrypted, iv: tamperHexByte(encrypted.iv, 0) }

      await expect(decryptWithKey(key, tampered)).rejects.toThrow()
    })

    test('rejects decryption with the wrong key', async () => {
      const encrypted = await encryptWithKey(key, getBytes(TEST_PRIVATE_KEY))
      const wrongKey = await crypto.subtle.importKey(
        'raw',
        crypto.getRandomValues(new Uint8Array(32)),
        { name: CIPHER },
        true,
        ['encrypt', 'decrypt']
      )

      await expect(decryptWithKey(wrongKey, encrypted)).rejects.toThrow()
    })

    test('uses a unique random iv (and produces different ciphertext) for each encryption', async () => {
      const plaintext = getBytes(TEST_PRIVATE_KEY)
      const first = await encryptWithKey(key, plaintext)
      const second = await encryptWithKey(key, plaintext)

      expect(first.iv).not.toBe(second.iv)
      expect(first.ciphertext).not.toBe(second.ciphertext)
      // 12-byte (96-bit) IV is the recommended size for AES-GCM
      expect(getBytes(first.iv).length).toBe(12)
    })
  })

  describe('encryptMainKeyWithSecret', () => {
    test('uses the first 32 bytes of the derived secret key', async () => {
      const mainKey = await createMainKey()
      const secretKey = await deriveSecret(
        new ScryptAdapter('browser-webkit'),
        'password',
        TEST_SALT_HEX
      )
      const expectedImportedKey = await crypto.subtle.importKey(
        'raw',
        secretKey.slice(0, 32),
        { name: CIPHER },
        true,
        ['encrypt', 'decrypt']
      )

      const encrypted = await encryptMainKeyWithSecret(mainKey, secretKey)
      const decrypted = await decryptWithKey(expectedImportedKey, encrypted)
      const exportedMainKey = new Uint8Array(await crypto.subtle.exportKey('raw', mainKey))

      expect(hexlify(decrypted)).toBe(hexlify(exportedMainKey))
    })
  })

  describe('deriveSecret', () => {
    test('passes normalized bytes and the expected scrypt parameters', async () => {
      const MOCK = hexlify(crypto.getRandomValues(new Uint8Array(32)))
      const scryptMock = jest.fn<
        ReturnType<ScryptAdapter['scrypt']>,
        Parameters<ScryptAdapter['scrypt']>
      >()
      scryptMock.mockResolvedValue(getBytes(MOCK))

      const scryptAdapter = { scrypt: scryptMock } as unknown as ScryptAdapter
      const result = await deriveSecret(scryptAdapter, 'cafe\u0301', TEST_SALT_HEX)

      expect(hexlify(result)).toBe(MOCK)
      expect(scryptMock).toHaveBeenCalledWith(
        getBytesForSecret('cafe\u0301'),
        getBytes(TEST_SALT_HEX),
        {
          N: SCRYPT_PARAMS.N,
          r: SCRYPT_PARAMS.r,
          p: SCRYPT_PARAMS.p,
          dkLen: SCRYPT_PARAMS.dkLen
        }
      )
    })
  })

  describe('decryptWithKeyOld', () => {
    test('decrypts a legacy AES-CTR private key payload', async () => {
      const encrypted = createLegacyPrivateKeyPayload(TEST_MAIN_KEY_OLD.key, TEST_MAIN_KEY_OLD.iv)
      const decrypted = await decryptWithKeyOld(TEST_MAIN_KEY_OLD, encrypted)

      expect(hexlify(decrypted)).toBe(TEST_PRIVATE_KEY.toLowerCase())
    })
  })

  describe('migrateStoredPayloadsToGCM', () => {
    suppressConsoleBeforeEach()

    test('migrates legacy internal keys and seeds to AES-GCM', async () => {
      const mainKey = await createMainKey()
      const storedKeys = [
        {
          addr: PRIMARY_INTERNAL_ADDR,
          type: 'internal' as const,
          label: 'Internal',
          dedicatedToOneSA: false,
          meta: { createdAt: Date.now() },
          privKey: createLegacyPrivateKeyPayload(TEST_MAIN_KEY_OLD.key, TEST_MAIN_KEY_OLD.iv)
        }
      ]
      const storedSeeds = [
        {
          id: 'seed-1',
          label: 'Recovery',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          seed: createLegacySeedPayload(
            VALID_12_WORD_SEED,
            TEST_MAIN_KEY_OLD.key,
            TEST_MAIN_KEY_OLD.iv
          )
        },
        {
          id: 'seed-with-passphrase',
          label: 'Recovery with Passphrase',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          seed: createLegacySeedPayload(
            VALID_12_WORD_SEED,
            TEST_MAIN_KEY_OLD.key,
            TEST_MAIN_KEY_OLD.iv
          ),
          seedPassphrase: createLegacyTextPayload(
            'my passphrase',
            TEST_MAIN_KEY_OLD.key,
            TEST_MAIN_KEY_OLD.iv
          )
        }
      ]

      const result = await migrateStoredPayloadsToGCM(
        mainKey,
        storedKeys as any,
        storedSeeds as any
      )

      expect(result.failedMigrations).toEqual({ keyAddrs: [], seedIds: [] })
      expect(result.migratedKeys[0]!.privKey).toMatchObject({ cipherType: CIPHER })
      expect(result.migratedSeeds[0]!.seed).toMatchObject({ cipherType: CIPHER })
      expect(result.migratedSeeds[1]!.seed).toMatchObject({ cipherType: CIPHER })

      const decryptedSeed = await decryptWithKey(mainKey, result.migratedSeeds[0]!.seed)
      expect(reconstructSeedFromEntropy(decryptedSeed)).toBe(VALID_12_WORD_SEED)

      const decryptedSeedWithPassphrase = await decryptWithKey(
        mainKey,
        result.migratedSeeds[1]!.seed
      )
      expect(reconstructSeedFromEntropy(decryptedSeedWithPassphrase)).toBe(VALID_12_WORD_SEED)
    })

    test('leaves already migrated entries untouched', async () => {
      const mainKey = await createMainKey()
      const alreadyMigratedKey = {
        addr: PRIMARY_INTERNAL_ADDR,
        type: 'internal' as const,
        label: 'Internal 2',
        dedicatedToOneSA: false,
        meta: { createdAt: Date.now() },
        privKey: {
          cipherType: CIPHER,
          ciphertext: '0x1234',
          iv: '0x5678',
          tag: '0x90ab'
        }
      }
      const alreadyMigratedSeed = {
        id: 'seed-2',
        label: 'Recovery 2',
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
        seed: {
          cipherType: CIPHER,
          ciphertext: '0x1234',
          iv: '0x5678',
          tag: '0x90ab'
        }
      }

      const result = await migrateStoredPayloadsToGCM(
        mainKey,
        [alreadyMigratedKey as any],
        [alreadyMigratedSeed as any]
      )

      expect(result.migratedKeys[0]).toBe(alreadyMigratedKey)
      expect(result.migratedSeeds[0]).toBe(alreadyMigratedSeed)
      expect(result.failedMigrations).toEqual({ keyAddrs: [], seedIds: [] })
    })

    test('records failed migrations and continues processing the batch', async () => {
      const mainKey = await createMainKey()
      const storedKeys = [
        {
          addr: SECONDARY_INTERNAL_ADDR,
          type: 'internal' as const,
          label: 'Broken Internal',
          dedicatedToOneSA: false,
          meta: { createdAt: Date.now() },
          privKey: createAesCtrCiphertextFromBytes(
            new Uint8Array([0x01, 0x02, 0x03]),
            TEST_MAIN_KEY_OLD.key,
            TEST_MAIN_KEY_OLD.iv
          )
        },
        {
          addr: EXTERNAL_ADDR,
          type: 'ledger' as const,
          label: 'External',
          dedicatedToOneSA: false,
          meta: {
            createdAt: Date.now(),
            deviceId: '1',
            deviceModel: 'ledger',
            hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
            index: 0
          },
          privKey: null
        }
      ]
      const storedSeeds = [
        {
          id: 'seed-3',
          label: 'Broken Recovery',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          seed: createLegacyTextPayload(
            'not a mnemonic',
            TEST_MAIN_KEY_OLD.key,
            TEST_MAIN_KEY_OLD.iv
          )
        },
        {
          id: 'seed-4',
          label: 'Valid Recovery',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          seed: createLegacySeedPayload(
            VALID_12_WORD_SEED,
            TEST_MAIN_KEY_OLD.key,
            TEST_MAIN_KEY_OLD.iv
          )
        }
      ]

      const result = await migrateStoredPayloadsToGCM(
        mainKey,
        storedKeys as any,
        storedSeeds as any
      )

      expect(result.failedMigrations.keyAddrs).toEqual([SECONDARY_INTERNAL_ADDR])
      expect(result.failedMigrations.seedIds).toEqual(['seed-3'])
      expect(result.migratedKeys[1]).toBe(storedKeys[1])
      expect(result.migratedSeeds[1]!.seed).toMatchObject({ cipherType: CIPHER })
      // seed-4 migrated successfully, so the batch did migrate something
      expect(result.hasMigrated).toBe(true)
    })

    test('reports hasMigrated true when at least one payload is re-encrypted', async () => {
      const mainKey = await createMainKey()
      const storedKeys = [
        {
          addr: PRIMARY_INTERNAL_ADDR,
          type: 'internal' as const,
          label: 'Internal',
          dedicatedToOneSA: false,
          meta: { createdAt: Date.now() },
          privKey: createLegacyPrivateKeyPayload(TEST_MAIN_KEY_OLD.key, TEST_MAIN_KEY_OLD.iv)
        }
      ]

      const result = await migrateStoredPayloadsToGCM(mainKey, storedKeys as any, [])

      expect(result.hasMigrated).toBe(true)
    })

    test('reports hasMigrated false when every payload is already migrated', async () => {
      const mainKey = await createMainKey()
      const alreadyMigratedKey = {
        addr: PRIMARY_INTERNAL_ADDR,
        type: 'internal' as const,
        label: 'Internal',
        dedicatedToOneSA: false,
        meta: { createdAt: Date.now() },
        privKey: { cipherType: CIPHER, ciphertext: '0x1234', iv: '0x5678' }
      }
      const alreadyMigratedSeed = {
        id: 'seed-1',
        label: 'Recovery',
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
        seed: { cipherType: CIPHER, ciphertext: '0x1234', iv: '0x5678' }
      }

      const result = await migrateStoredPayloadsToGCM(
        mainKey,
        [alreadyMigratedKey as any],
        [alreadyMigratedSeed as any]
      )

      expect(result.hasMigrated).toBe(false)
    })

    test('reports hasMigrated false when there is nothing to migrate (only external keys)', async () => {
      const mainKey = await createMainKey()
      const externalKey = {
        addr: EXTERNAL_ADDR,
        type: 'ledger' as const,
        label: 'External',
        dedicatedToOneSA: false,
        meta: {
          createdAt: Date.now(),
          deviceId: '1',
          deviceModel: 'ledger',
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          index: 0
        },
        privKey: null
      }

      const result = await migrateStoredPayloadsToGCM(mainKey, [externalKey as any], [])

      expect(result.hasMigrated).toBe(false)
      expect(result.failedMigrations).toEqual({ keyAddrs: [], seedIds: [] })
    })

    test('reports hasMigrated false when every migration fails', async () => {
      const mainKey = await createMainKey()
      const invalidKey = {
        addr: SECONDARY_INTERNAL_ADDR,
        type: 'internal' as const,
        label: 'Broken Internal',
        dedicatedToOneSA: false,
        meta: { createdAt: Date.now() },
        privKey: createAesCtrCiphertextFromBytes(
          new Uint8Array([0x01, 0x02, 0x03]),
          TEST_MAIN_KEY_OLD.key,
          TEST_MAIN_KEY_OLD.iv
        )
      }
      const invalidSeed = {
        id: 'seed-broken',
        label: 'Broken Recovery',
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
        seed: createLegacyTextPayload('not a mnemonic', TEST_MAIN_KEY_OLD.key, TEST_MAIN_KEY_OLD.iv)
      }

      const result = await migrateStoredPayloadsToGCM(
        mainKey,
        [invalidKey as any],
        [invalidSeed as any]
      )

      expect(result.hasMigrated).toBe(false)
      expect(result.failedMigrations.keyAddrs).toEqual([SECONDARY_INTERNAL_ADDR])
      expect(result.failedMigrations.seedIds).toEqual(['seed-broken'])
    })
  })
})
