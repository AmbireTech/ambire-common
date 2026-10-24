import { PRIVACY_POOLS_SIGNING_KEY_PATH } from '../../consts/privacyPools'
import {
  TORNADO_CASH_ACCOUNT_KEY_PATH,
  TORNADO_CASH_NOTE_KEY_KINDS
} from '../../consts/tornadoCash'
import { PrivacyProviderId } from '../../interfaces/privateAccount'

/** The largest BIP-32 index that can be hardened. */
const MAX_HARDENED_INDEX = 2 ** 31 - 1

/** Parses a hardened BIP-32 segment such as `12'` into 12, or null for anything else. */
const parseHardenedIndex = (segment: string): number | null => {
  if (!segment.endsWith("'")) return null

  const digits = segment.slice(0, -1)
  if (!digits || [...digits].some((char) => char < '0' || char > '9')) return null
  // A leading zero would let two strings name the same key
  if (digits.length > 1 && digits.startsWith('0')) return null

  const index = Number(digits)
  return index <= MAX_HARDENED_INDEX ? index : null
}

/** `m/29795'/1'/0'/{kind}'/{depositIndex}'`, with a kind the SDK uses - see `TORNADO_CASH_ACCOUNT_KEY_PATH`. */
const isTornadoCashNoteKeyPath = (path: string): boolean => {
  const accountPrefix = `${TORNADO_CASH_ACCOUNT_KEY_PATH}/`
  if (!path.startsWith(accountPrefix)) return false

  const segments = path.slice(accountPrefix.length).split('/')
  if (segments.length !== 2) return false

  const [kind, depositIndex] = segments.map(parseHardenedIndex)
  if (kind === null || kind === undefined || depositIndex === null || depositIndex === undefined)
    return false

  return (TORNADO_CASH_NOTE_KEY_KINDS as readonly number[]).includes(kind)
}

/**
 * Whether a privacy plugin may get the key at `path`. The plugins choose the paths, so this is the
 * security boundary that keeps them away from the user's EVM keys and from other providers' keys.
 */
export const isAllowedPrivacyKeyPath = (providerId: PrivacyProviderId, path: string): boolean => {
  if (providerId === 'privacyPools') return path === PRIVACY_POOLS_SIGNING_KEY_PATH
  if (providerId === 'tornadoCash') return isTornadoCashNoteKeyPath(path)

  return false
}
