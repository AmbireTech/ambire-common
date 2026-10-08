import {
  getCreate2Address,
  hexlify,
  isAddress,
  isHexString,
  keccak256,
  toUtf8Bytes,
  toUtf8String
} from 'ethers'
import { gzip, Inflate } from 'pako'

import { FeatureFlags } from '../../consts/featureFlags'
import { Account } from '../../interfaces/account'
import { Contacts } from '../../interfaces/addressBook'
import {
  MainKeyEncryptedWithSecret,
  StoredKey,
  StoredKeystoreSeed
} from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { CIPHER, SCRYPT_PARAMS, tryParseGcmPayload } from '../keystore/keystore'
import { sanityCheckImportantNetworkProperties } from '../networks/networks'
import { parse, stringify } from '../richJson/richJson'

/**
 * The UR type used to transport the accounts sync payload over animated QR codes.
 */
export const ACCOUNTS_SYNC_UR_TYPE = 'ambire-account-sync'

export const ACCOUNTS_SYNC_PAYLOAD_VERSION = 1

/**
 * The feature flags the user controls from the privacy opt-outs settings. Only these
 * travel with the synced settings, the rest are internal to each product.
 */
export const ACCOUNTS_SYNC_FEATURE_FLAGS = [
  'networkConfig',
  'tokenAndDefiAutoDiscovery',
  'clearSigning',
  'apiForFunctionSelectors',
  'ambireSmartAccounts',
  'scamAndPhishingChecker',
  'swapAndBridgeTokenInfo',
  'walletStakingWithdrawalsLookup',
  'gasTank',
  'erc4337',
  'tokenPrices',
  'eip7702',
  'keepEnsProfilesUpToDate',
  'ledgerSigningReports'
] as const satisfies (keyof FeatureFlags)[]

/**
 * Settings that the products share: the privacy opt-outs kept in ambire-common and the
 * ones each app keeps on its own (like the theme), which the app applies itself.
 */
export type AccountsSyncSettings = {
  featureFlags: Partial<Pick<FeatureFlags, (typeof ACCOUNTS_SYNC_FEATURE_FLAGS)[number]>>
  disabledSwapProviderIds: string[]
  app: { [key: string]: string | boolean }
}

/** What else, besides the selected accounts, the user chose to send to the other product */
export type AccountsSyncExportOptions = {
  includeSeeds: boolean
  /** The app's own settings, present only when the user chose to sync the settings */
  appSettings?: AccountsSyncSettings['app']
  includeNetworks: boolean
  includeContacts: boolean
}

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
  /** Missing when the user did not choose to sync the settings */
  settings?: AccountsSyncSettings
  /** Missing when the user did not choose to sync the networks */
  networks?: Network[]
  /** The manually added contacts. Missing when the user did not choose to sync them */
  contacts?: Contacts
}

const requireGcmPayload = (payload: any, what: string) => {
  if (!tryParseGcmPayload(payload))
    throw new Error(`accountsSync: ${what} is not encrypted with ${CIPHER}`)
}

const validateSecret = (secret: any) => {
  if (!secret || secret.id !== 'password')
    throw new Error('accountsSync: missing the password protected main key')

  // Deriving the key allocates 128 * N * r bytes, so the scanned params are pinned to the
  // ones every Ambire product uses, instead of letting a hostile QR code ask for gigabytes
  const { salt, N, r, p, dkLen } = secret.scryptParams || {}
  const hasValidScryptParams =
    typeof salt === 'string' &&
    N === SCRYPT_PARAMS.N &&
    r === SCRYPT_PARAMS.r &&
    p === SCRYPT_PARAMS.p &&
    dkLen === SCRYPT_PARAMS.dkLen
  if (!hasValidScryptParams) throw new Error('accountsSync: invalid scrypt params')

  requireGcmPayload(secret.aesEncrypted, 'the main key')
}

/**
 * Recomputes the address the factory deploys for the scanned bytecode, the same way the
 * AccountPicker does for linked accounts, so a scanned account cannot claim to be an
 * address it isn't. Safe accounts are left out, because deriving their address needs the
 * factory's proxy creation code, which is only available over an RPC call.
 */
const validateAccountCreation = (account: any) => {
  const { factoryAddr, bytecode, salt } = account.creation
  if (!isAddress(factoryAddr) || !isHexString(bytecode) || !isHexString(salt, 32))
    throw new Error(`accountsSync: invalid creation data for account ${account.addr}`)

  if (
    getCreate2Address(factoryAddr, salt, keccak256(bytecode)).toLowerCase() !==
    account.addr.toLowerCase()
  )
    throw new Error(`accountsSync: account ${account.addr} does not match its creation data`)
}

const isPrivilege = (privilege: any) =>
  Array.isArray(privilege) && isAddress(privilege[0]) && isHexString(privilege[1])

const validateAccounts = (accounts: any) => {
  if (!Array.isArray(accounts) || !accounts.length)
    throw new Error('accountsSync: no accounts in the payload')

  accounts.forEach((account) => {
    if (!account || !isAddress(account.addr)) throw new Error('accountsSync: invalid account addr')
    if (!Array.isArray(account.associatedKeys) || !account.associatedKeys.every(isAddress))
      throw new Error('accountsSync: invalid account associatedKeys')
    if (!Array.isArray(account.initialPrivileges) || !account.initialPrivileges.every(isPrivilege))
      throw new Error('accountsSync: invalid account initialPrivileges')
    if (!account.preferences?.label) throw new Error('accountsSync: invalid account preferences')

    if (account.creation) return validateAccountCreation(account)

    // An EOA is controlled by its own address only, so anything else means the scanned
    // account was tampered with. Safe accounts have no `creation`, but do list their owners
    if (
      !account.safeCreation &&
      (account.associatedKeys.length !== 1 ||
        account.associatedKeys[0].toLowerCase() !== account.addr.toLowerCase())
    )
      throw new Error(`accountsSync: account ${account.addr} has unexpected associatedKeys`)
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

const isPlainObject = (value: any) => !!value && typeof value === 'object' && !Array.isArray(value)

const validateSettings = (settings: any) => {
  if (settings === undefined) return
  if (!isPlainObject(settings)) throw new Error('accountsSync: invalid settings')

  const { featureFlags, disabledSwapProviderIds, app } = settings
  if (
    !isPlainObject(featureFlags) ||
    !Object.values(featureFlags).every((v) => typeof v === 'boolean')
  )
    throw new Error('accountsSync: invalid feature flags')
  if (
    !Array.isArray(disabledSwapProviderIds) ||
    !disabledSwapProviderIds.every((id) => typeof id === 'string')
  )
    throw new Error('accountsSync: invalid disabled swap providers')
  if (
    !isPlainObject(app) ||
    !Object.values(app).every((v) => typeof v === 'string' || typeof v === 'boolean')
  )
    throw new Error('accountsSync: invalid app settings')
}

const validateNetworks = (networks: any) => {
  if (networks === undefined) return
  if (!Array.isArray(networks) || !networks.every(sanityCheckImportantNetworkProperties))
    throw new Error('accountsSync: invalid networks')
}

const validateContacts = (contacts: any) => {
  if (contacts === undefined) return
  if (!Array.isArray(contacts)) throw new Error('accountsSync: invalid contacts')

  contacts.forEach((contact) => {
    if (!contact || !isAddress(contact.address))
      throw new Error('accountsSync: invalid contact address')
    if (typeof contact.name !== 'string' || !contact.name.trim())
      throw new Error(`accountsSync: invalid name of contact ${contact.address}`)
  })
}

/**
 * A payload takes a few hundred bytes per account, so this leaves room for far more
 * accounts than anyone holds, while keeping a hostile QR code from inflating into
 * gigabytes of memory in the background.
 */
const MAX_DECOMPRESSED_PAYLOAD_SIZE = 2 * 1024 * 1024

/**
 * Inflates the scanned bytes, giving up as soon as they expand past what a sync payload
 * could ever be, instead of allocating whatever the compressed data asks for.
 */
const decompress = (bytes: Uint8Array): Uint8Array => {
  const inflate = new Inflate()
  const chunks: Uint8Array[] = []
  let size = 0

  // pako has no way to abort a stream, so oversized chunks are counted and dropped
  // (which keeps the memory flat) and the whole stream is rejected afterwards
  inflate.onData = (chunk: Uint8Array) => {
    size += chunk.length
    if (size <= MAX_DECOMPRESSED_PAYLOAD_SIZE) chunks.push(chunk)
  }

  inflate.push(bytes, true)

  if (inflate.err) throw new Error(`accountsSync: failed to decompress the payload: ${inflate.msg}`)
  if (size > MAX_DECOMPRESSED_PAYLOAD_SIZE)
    throw new Error('accountsSync: the payload is too large to be a sync payload')

  const decompressed = new Uint8Array(size)
  let offset = 0
  chunks.forEach((chunk) => {
    decompressed.set(chunk, offset)
    offset += chunk.length
  })

  return decompressed
}

/**
 * Serializes the payload to the hex encoded bytes carried by the animated QR codes.
 * Gzipped first, because JSON full of hex strings compresses 3x or better, and every
 * byte saved is one less QR frame the other device has to catch. Rich JSON, because
 * the networks hold bigints.
 */
export const serializeAccountsSyncPayload = (payload: AccountsSyncPayload): string =>
  hexlify(gzip(toUtf8Bytes(stringify(payload))))

/**
 * Parses and validates the bytes assembled from the scanned animated QR codes.
 * Throws if the payload is incomplete, tampered with or produced by an
 * incompatible (newer) app version.
 */
export const parseAccountsSyncPayload = (bytes: Uint8Array): AccountsSyncPayload => {
  // Left to throw on its own, so that a corrupt stream and an oversized one stay
  // distinguishable from data that decompressed fine but isn't a sync payload
  const decompressed = decompress(bytes)

  let payload: any
  try {
    payload = parse(toUtf8String(decompressed))
  } catch {
    throw new Error('accountsSync: the scanned data is not a valid sync payload')
  }

  if (payload?.v !== ACCOUNTS_SYNC_PAYLOAD_VERSION)
    throw new Error(`accountsSync: unsupported payload version ${payload?.v}`)

  validateSecret(payload.secret)
  validateAccounts(payload.accounts)
  validateKeys(payload.keys)
  validateSeeds(payload.seeds)
  validateSettings(payload.settings)
  validateNetworks(payload.networks)
  validateContacts(payload.contacts)

  return payload
}
