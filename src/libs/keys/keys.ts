import { Key, StoredKey } from '../../interfaces/keystore'

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

// As of version 4.33.0, we no longer store the key preferences in a separate object called keyPreferences in the storage.
// Migration is needed because each preference (like key label)
// is now part of the Key interface and managed by the KeystoreController.
export function migrateKeyPreferencesToKeystoreKeys(
  keyPreferences: {
    addr: Key['addr']
    type: Key['type']
    label: string
  }[],
  keystoreKeys: StoredKey[]
) {
  return keystoreKeys.map((key) => {
    if (key.label) return key

    const keyPref = keyPreferences.find((k) => k.addr === key.addr && k.type === key.type)

    if (keyPref) {
      return { ...key, label: keyPref.label }
    }

    return key
  })
}

// As of version 4.33.0, we introduced createdAt prop to the Key interface to help with sorting and add more details for the Keys.
export function migrateKeyMetaNullToKeyMetaCreatedAt(keystoreKeys: StoredKey[]) {
  return keystoreKeys.map((key) => {
    if (!key.meta) return { ...key, meta: { createdAt: null } } as StoredKey
    if (!key.meta.createdAt) return { ...key, meta: { ...key.meta, createdAt: null } } as StoredKey

    return key
  })
}
