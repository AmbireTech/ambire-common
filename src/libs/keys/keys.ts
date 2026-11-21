import { Account, AccountId } from '../../interfaces/account'
import { Key, StoredKey } from '../../interfaces/keystore'

/**
 * The id of the saved recovery phrase a key was derived from, if any. Only internal keys can come
 * from one: a hardware wallet key's `meta` has no `fromSeedId`, and a PQ1 key's can't have one.
 */
export const getKeySeedId = (key: Key | StoredKey): string | undefined =>
  key.type === 'internal' ? key.meta.fromSeedId : undefined

export const DEFAULT_KEY_LABEL_PATTERN = /^Key (\d+)$/
export const getDefaultKeyLabel = (prevKeys: Key[], i: number) => {
  const number = prevKeys.length + i + 1

  return `Key ${number}`
}

export const getExistingKeyLabel = (keys: Key[], addr: string, accountPickerType?: Key['type']) => {
  let key: Key | undefined
  if (accountPickerType) {
    key = keys.find((k) => k.addr === addr && k.type === accountPickerType)
  } else {
    key = keys.find((k) => k.addr === addr)
  }
  return key?.label
}

export const getAccountKeysCount = ({
  accountAddr,
  accounts,
  keys
}: {
  accountAddr: AccountId
  accounts: Account[]
  keys: Key[]
}) => {
  const account = accounts.find((x) => x.addr === accountAddr)

  return keys.filter((x) => account?.associatedKeys.includes(x.addr)).length
}
