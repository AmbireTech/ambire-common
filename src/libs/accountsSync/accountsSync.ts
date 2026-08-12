import { hexlify, isAddress, toUtf8Bytes, toUtf8String } from 'ethers'

import { Account } from '../../interfaces/account'
import {
  MainKeyEncryptedWithSecret,
  StoredKey,
  StoredKeystoreSeed
} from '../../interfaces/keystore'
import { CIPHER, tryParseGcmPayload } from '../keystore/keystore'

/**
 * The UR type used to transport the accounts sync payload over animated QR codes.
 */
export const ACCOUNTS_SYNC_UR_TYPE = 'ambire-account-sync'

export const ACCOUNTS_SYNC_PAYLOAD_VERSION = 1

/**
 * Everything needed to move accounts (and the keys controlling them) from one
 * Ambire product to another. Sensitive data travels exactly as it is stored:
 * private keys and seeds stay encrypted with the exporting device's main key,
 * which itself travels wrapped with the exporting device's password (`secret`).
 * The importing device unwraps the main key with that password, decrypts and
 * re-encrypts everything with its own main key.
 */
export type AccountsSyncPayload = {
  v: typeof ACCOUNTS_SYNC_PAYLOAD_VERSION
  secret: MainKeyEncryptedWithSecret
  accounts: Account[]
  keys: StoredKey[]
  seeds: StoredKeystoreSeed[]
}

const requireGcmPayload = (payload: any, what: string) => {
  if (!tryParseGcmPayload(payload))
    throw new Error(`accountsSync: ${what} is not encrypted with ${CIPHER}`)
}

const validateSecret = (secret: any) => {
  if (!secret || secret.id !== 'password')
    throw new Error('accountsSync: missing the password protected main key')

  const { salt, N, r, p, dkLen } = secret.scryptParams || {}
  const hasValidScryptParams =
    typeof salt === 'string' &&
    typeof N === 'number' &&
    typeof r === 'number' &&
    typeof p === 'number' &&
    typeof dkLen === 'number'
  if (!hasValidScryptParams) throw new Error('accountsSync: invalid scrypt params')

  requireGcmPayload(secret.aesEncrypted, 'the main key')
}

const validateAccounts = (accounts: any) => {
  if (!Array.isArray(accounts) || !accounts.length)
    throw new Error('accountsSync: no accounts in the payload')

  accounts.forEach((account) => {
    if (!account || !isAddress(account.addr)) throw new Error('accountsSync: invalid account addr')
    if (!Array.isArray(account.associatedKeys))
      throw new Error('accountsSync: invalid account associatedKeys')
    if (!account.preferences?.label) throw new Error('accountsSync: invalid account preferences')
  })
}

const validateKeys = (keys: any) => {
  if (!Array.isArray(keys)) throw new Error('accountsSync: invalid keys')

  keys.forEach((key) => {
    if (!key || !isAddress(key.addr)) throw new Error('accountsSync: invalid key addr')
    if (typeof key.type !== 'string') throw new Error('accountsSync: invalid key type')

    if (key.type === 'internal') return requireGcmPayload(key.privKey, `key ${key.addr}`)
    // External keys are stored on the hardware device, so there is nothing to encrypt
    if (key.privKey !== null)
      throw new Error(`accountsSync: external key ${key.addr} has a privKey`)
  })
}

const validateSeeds = (seeds: any) => {
  if (!Array.isArray(seeds)) throw new Error('accountsSync: invalid seeds')

  seeds.forEach((seed) => {
    if (!seed?.id) throw new Error('accountsSync: invalid seed id')
    requireGcmPayload(seed.seed, `seed ${seed.id}`)
    if (seed.seedPassphrase) requireGcmPayload(seed.seedPassphrase, `seed passphrase ${seed.id}`)
  })
}

/**
 * Serializes the payload to the hex encoded bytes carried by the animated QR codes.
 */
export const serializeAccountsSyncPayload = (payload: AccountsSyncPayload): string =>
  hexlify(toUtf8Bytes(JSON.stringify(payload)))

/**
 * Parses and validates the bytes assembled from the scanned animated QR codes.
 * Throws if the payload is incomplete, tampered with or produced by an
 * incompatible (newer) app version.
 */
export const parseAccountsSyncPayload = (bytes: Uint8Array): AccountsSyncPayload => {
  let payload: any
  try {
    payload = JSON.parse(toUtf8String(bytes))
  } catch {
    throw new Error('accountsSync: the scanned data is not a valid sync payload')
  }

  if (payload?.v !== ACCOUNTS_SYNC_PAYLOAD_VERSION)
    throw new Error(`accountsSync: unsupported payload version ${payload?.v}`)

  validateSecret(payload.secret)
  validateAccounts(payload.accounts)
  validateKeys(payload.keys)
  validateSeeds(payload.seeds)

  return payload
}
