import { Account, AccountId } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'

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
