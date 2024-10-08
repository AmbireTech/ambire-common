import { BIP44_STANDARD_DERIVATION_TEMPLATE, HD_PATH_TEMPLATE_TYPE } from '../../consts/derivation'
import { Account, AccountId } from '../../interfaces/account'
import { Key, KeystoreSeed, StoredKey } from '../../interfaces/keystore'

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
export const getShouldMigrateKeyMetaNullToKeyMetaCreatedAt = (keystoreKeys: StoredKey[]) =>
  keystoreKeys.some((key) => {
    const internalKeyWithoutMeta = key.type === 'internal' && !key.meta
    const externalKeyWithoutCreatedAt = key.type !== 'internal' && !('createdAt' in key.meta)

    return internalKeyWithoutMeta || externalKeyWithoutCreatedAt
  })
export function migrateKeyMetaNullToKeyMetaCreatedAt(keystoreKeys: StoredKey[]) {
  return keystoreKeys.map((key) => {
    if (!key.meta) return { ...key, meta: { createdAt: null } } as StoredKey
    if (!key.meta.createdAt) return { ...key, meta: { ...key.meta, createdAt: null } } as StoredKey

    return key
  })
}

// As of version v4.33.0, user can change the HD path when importing a seed.
// Migration is needed because previously the HD path was not stored,
// and the default used was `BIP44_STANDARD_DERIVATION_TEMPLATE`.
export const getShouldMigrateKeystoreSeedsWithoutHdPath = (
  keystoreSeeds: string[] | KeystoreSeed[]
) =>
  // @ts-ignore TS complains, but we know that keystoreSeeds is either an array of strings or an array of objects
  !!keystoreSeeds?.length && keystoreSeeds.every((seed) => typeof seed === 'string')
export function migrateKeystoreSeedsWithoutHdPathTemplate(
  prevKeystoreSeeds: string[]
): { seed: string; hdPathTemplate: HD_PATH_TEMPLATE_TYPE }[] {
  return prevKeystoreSeeds.map((seed) => ({
    seed,
    hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
  }))
}
