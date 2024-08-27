import { Key } from '../../interfaces/keystore'

export const DEFAULT_KEY_LABEL_PATTERN = /^Key (\d+)$/
export const getDefaultKeyLabel = (prevKeys: Key[], i: number) => {
  const number = prevKeys.length + i + 1

  return `Key ${number}`
}

export const getExistingKeyLabel = (keys: Key[], addr: string, accountAdderType?: Key['type']) => {
  let key: Key | undefined
  if (accountAdderType) {
    key = keys.find((k) => k.addr === addr && k.type === accountAdderType)
  } else {
    key = keys.find((k) => k.addr === addr)
  }
  return key?.label
}
