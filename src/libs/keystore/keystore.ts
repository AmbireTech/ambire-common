import aes from 'aes-js'
import { getBytes, hexlify, Mnemonic, toUtf8Bytes } from 'ethers'

import {
  AESGCMEncrypted,
  KeystoreEncryptedPayload,
  MainKey,
  MainKeyOld,
  StoredKey,
  StoredKeystoreSeed
} from '@/interfaces/keystore'
import { ScryptAdapter } from '@/libs/scrypt/scryptAdapter'
import wait from '@/utils/wait'

/**
 * The old encryption method used AES-CTR, which doesn't include authentication and is less secure.
 * The new method uses AES-GCM, which provides confidentiality and integrity through authenticated encryption.
 */
export const CIPHER_OLD = 'aes-128-ctr'
/**
 * The encryption method used to encrypt secrets, seeds and private keys in the keystore.
 */
export const CIPHER = 'AES-GCM'

// TODO: We need only 32 bytes (256 bits) for the AES-GCM key, but scrypt is currently deriving 64 bytes.
// Maybe we can optimize this in the future by deriving only 32 bytes.
export const SCRYPT_PARAMS = { N: 131072, r: 8, p: 1, dkLen: 64 }

export const getBytesForSecret = (secret: string) => {
  // see https://github.com/ethers-io/ethers.js/blob/v5/packages/json-wallets/src.ts/utils.ts#L19-L24
  return toUtf8Bytes(secret, 'NFKC')
}

/**
 * Extracts entropy from a BIP39 seed phrase.
 */
export const extractEntropyFromSeed = (seed: string): Uint8Array => {
  if (!Mnemonic.isValidMnemonic(seed)) {
    throw new Error('keystore: cannot extract entropy from invalid seed phrase')
  }

  const mnemonic = Mnemonic.fromPhrase(seed)
  return getBytes(mnemonic.entropy)
}

/**
 * Reconstructs a BIP39 seed phrase from entropy and optional passphrase.
 */
export const reconstructSeedFromEntropy = (
  entropy: Uint8Array,
  passphrase?: string | null
): string => {
  const mnemonic = Mnemonic.fromEntropy(entropy, passphrase || undefined)

  return mnemonic.phrase
}

/**
 * Encrypts data using Web Crypto AES-GCM.
 */
export const encryptWithKey = async (
  key: CryptoKey,
  data: Uint8Array
): Promise<AESGCMEncrypted> => {
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encrypted = await crypto.subtle.encrypt(
    { name: CIPHER, iv, tagLength: 128 },
    key,
    Buffer.from(data)
  )
  const encryptedBytes = new Uint8Array(encrypted)
  return {
    ciphertext: hexlify(encryptedBytes),
    iv: hexlify(iv),
    cipherType: CIPHER
  }
}

/**
 * The main key can be encrypted with many secrets (e.g., user password, biometrics-derived key and email vault).
 * This function takes the main key and a secret, and produces an AES-GCM encrypted payload.
 */
export const encryptMainKeyWithSecret = async (
  mainKey: CryptoKey,
  secretKey: Uint8Array<ArrayBuffer>
): Promise<AESGCMEncrypted> => {
  // Generate a crypto key out of the derived secret, so that we can use it for web crypto ops
  const importedSecretKey = await crypto.subtle.importKey(
    'raw',
    // use 256 bits (first 32 bytes)
    secretKey.slice(0, 32),
    { name: CIPHER },
    true,
    ['encrypt', 'decrypt']
  )

  const exportedMainKeyUint8Array = new Uint8Array(await crypto.subtle.exportKey('raw', mainKey!))

  return encryptWithKey(importedSecretKey, exportedMainKeyUint8Array)
}

/**
 * As the type is string | AESGCMEncrypted, we need to check if it's a GCM payload or a legacy string payload
 */
export const tryParseGcmPayload = (payload: KeystoreEncryptedPayload): AESGCMEncrypted | null => {
  if (!payload || typeof payload === 'string') return null

  if (payload.cipherType === undefined) return null
  if (payload.cipherType !== CIPHER) throw new Error('keystore: unsupported payload cipherType')
  if (typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') {
    throw new Error('keystore: invalid gcm payload shape')
  }

  return payload
}

/**
 * Decrypts a GCM-encrypted payload using the provided CryptoKey. Returns the decrypted data as a Uint8Array.
 */
export const decryptWithKey = async (
  key: CryptoKey,
  payload: KeystoreEncryptedPayload
): Promise<Uint8Array> => {
  if (!(key instanceof CryptoKey)) throw new Error('keystore: key is not a CryptoKey')

  const maybeGcmPayload = tryParseGcmPayload(payload)

  if (!maybeGcmPayload) {
    // Not a valid GCM, but also not a valid legacy payload
    if (typeof payload !== 'string') {
      throw new Error('keystore: invalid payload type for decryption')
    }

    const exported = await crypto.subtle.exportKey('raw', key)

    // key is first 16, iv is second 16 bytes of the exported key material
    const mainKeyOld: MainKeyOld = {
      key: new Uint8Array(exported.slice(0, 16)),
      iv: new Uint8Array(exported.slice(16, 32))
    }

    const decrypted = await decryptWithKeyOld(mainKeyOld, payload)

    return decrypted
  }

  const decrypted = await crypto.subtle.decrypt(
    {
      name: CIPHER,
      iv: new Uint8Array(getBytes(maybeGcmPayload.iv)),
      tagLength: 128
    },
    key,
    new Uint8Array(getBytes(maybeGcmPayload.ciphertext))
  )

  return new Uint8Array(decrypted)
}

/**
 * Used during migration to read legacy payloads
 */
export const decryptWithKeyOld = async (
  mainKeyOld: MainKeyOld,
  encryptedData: string
): Promise<Uint8Array> => {
  const counter = new aes.Counter(mainKeyOld.iv)
  const aesCtr = new aes.ModeOfOperation.ctr(mainKeyOld.key, counter)
  return aesCtr.decrypt(getBytes(encryptedData))
}

/**
 * We cannot!! use decryptWithKey or decryptWithKeyOld directly to decrypt CTR-encrypted seed data,
 * because that would require two method calls, which in turn initializes the AES instance twice and
 * results in different output, due to the counter being reset (starting from 0 on each initialization,
 * while the original encryption method continued the counter from the seed to the seedPassphrase)
 */
export const decryptSeedWithKeyOld = async (
  key: MainKey,
  encryptedSeed: string,
  encryptedSeedPassphrase: string | null
): Promise<{ seed: Uint8Array; seedPassphrase: Uint8Array | null }> => {
  const exported = await crypto.subtle.exportKey('raw', key)

  // key is first 16, iv is second 16 bytes of the exported key material
  const mainKeyOld: MainKeyOld = {
    key: new Uint8Array(exported.slice(0, 16)),
    iv: new Uint8Array(exported.slice(16, 32))
  }
  const counter = new aes.Counter(mainKeyOld.iv)
  const aesCtr = new aes.ModeOfOperation.ctr(mainKeyOld.key, counter)

  const decryptedSeed = aesCtr.decrypt(getBytes(encryptedSeed))
  const decryptedSeedPassphrase = encryptedSeedPassphrase
    ? aesCtr.decrypt(getBytes(encryptedSeedPassphrase))
    : null

  return { seed: decryptedSeed, seedPassphrase: decryptedSeedPassphrase }
}

/**
 * Computes a derived key from the given secret and salt using scrypt, yielding a key that can be used for encryption/decryption.
 *
 * @example - computes a secret key from a password
 */
export const deriveSecret = async (
  scryptAdapter: ScryptAdapter,
  secretValue: string,
  salt: string
): Promise<Uint8Array<ArrayBuffer>> => {
  // Use wait(0) to yield to the event loop and avoid blocking the UI
  await wait(0)
  const secretKey = await scryptAdapter.scrypt(getBytesForSecret(secretValue), getBytes(salt), {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    dkLen: SCRYPT_PARAMS.dkLen
  })
  await wait(0)

  return secretKey as Uint8Array<ArrayBuffer>
}

/**
 * Migrates legacy AES-CTR encrypted payloads to AES-GCM encryption.
 *
 * If already migrated (i.e., payloads are in GCM format), it returns the original payloads without any changes.
 */
export const migrateStoredPayloadsToGCM = async (
  mainKey: MainKey,
  storedKeys: StoredKey[],
  storedSeeds: StoredKeystoreSeed[]
): Promise<{
  migratedKeys: StoredKey[]
  migratedSeeds: StoredKeystoreSeed[]
  failedMigrations: { keyAddrs: string[]; seedIds: string[] }
  // Indicates whether at least one key or seed was actually re-encrypted to AES-GCM,
  // so the caller can skip persisting when there was nothing to migrate.
  hasMigrated: boolean
}> => {
  const failedMigrations: { keyAddrs: string[]; seedIds: string[] } = { keyAddrs: [], seedIds: [] }
  let hasMigrated = false

  const migratedKeys: StoredKey[] = await Promise.all(
    storedKeys.map(async (storedKey) => {
      try {
        const isNotInternalKey = storedKey.type !== 'internal' || !storedKey.privKey
        const isAlreadyMigrated = typeof storedKey.privKey !== 'string'

        if (isNotInternalKey || isAlreadyMigrated) return storedKey

        const decryptedKey = await decryptWithKey(mainKey, storedKey.privKey as string)

        if (getBytes(decryptedKey).length !== 32) {
          throw new Error(
            `decrypted private key has invalid length: expected 32 bytes, got ${
              getBytes(decryptedKey).length
            } bytes`
          )
        }

        const migratedPrivKey = await encryptWithKey(mainKey, getBytes(decryptedKey))
        // Flip the flag after the async operation to ensure it doesn't fail
        hasMigrated = true

        return {
          ...storedKey,
          privKey: migratedPrivKey
        }
      } catch (e: any) {
        console.error(`Failed to migrate key with addr ${storedKey.addr} to AES-GCM encryption:`, e)
        failedMigrations.keyAddrs.push(storedKey.addr)
        return storedKey
      }
    })
  )

  const migratedSeeds: StoredKeystoreSeed[] = await Promise.all(
    storedSeeds.map(async (storedSeed) => {
      try {
        const isAlreadyMigrated = typeof storedSeed.seed !== 'string'
        if (isAlreadyMigrated) return storedSeed

        const { seed: decryptedSeedBytes, seedPassphrase: decryptedSeedPassphrase } =
          await decryptSeedWithKeyOld(
            mainKey,
            storedSeed.seed as string,
            storedSeed.seedPassphrase as string | null
          )

        const decryptedSeedString = new TextDecoder().decode(decryptedSeedBytes)
        // Convert to entropy bytes, which is the raw form of the seed phrase without the mnemonic encoding
        const entropy = extractEntropyFromSeed(decryptedSeedString)

        const migratedSeed = {
          ...storedSeed,
          seed: await encryptWithKey(mainKey, entropy),
          seedPassphrase: decryptedSeedPassphrase
            ? await encryptWithKey(mainKey, decryptedSeedPassphrase)
            : null
        }
        // Flip the flag after the async operations to ensure they don't fail
        hasMigrated = true

        return migratedSeed
      } catch (e: any) {
        console.error(`Failed to migrate seed with id ${storedSeed.id} to AES-GCM encryption:`, e)
        failedMigrations.seedIds.push(storedSeed.id)
        return storedSeed
      }
    })
  )

  return {
    migratedKeys,
    migratedSeeds,
    failedMigrations,
    hasMigrated
  }
}
