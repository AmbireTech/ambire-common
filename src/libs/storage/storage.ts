import { Account } from '../../interfaces/account'
import { KeystoreSeed, StoredKey } from '../../interfaces/keystore'
import { CashbackStatus, LegacyCashbackStatus } from '../../interfaces/selectedAccount'
import { LegacyTokenPreference } from '../portfolio/customToken'

export const getShouldMigrateKeystoreSeedsWithoutHdPath = (
  keystoreSeeds: string[] | KeystoreSeed[]
) =>
  // @ts-ignore TS complains, but we know that keystoreSeeds is either an array of strings or an array of objects
  !!keystoreSeeds?.length && keystoreSeeds.every((seed) => typeof seed === 'string')

export const getShouldMigrateKeyMetaNullToKeyMetaCreatedAt = (keystoreKeys: StoredKey[]) =>
  keystoreKeys.some((key) => {
    const internalKeyWithoutMeta = key.type === 'internal' && !key.meta
    const externalKeyWithoutCreatedAt = key.type !== 'internal' && !('createdAt' in key.meta)

    return internalKeyWithoutMeta || externalKeyWithoutCreatedAt
  })

export const needsCashbackStatusMigration = (
  cashbackStatusByAccount: Record<Account['addr'], CashbackStatus | LegacyCashbackStatus>
) => {
  return Object.values(cashbackStatusByAccount).some(
    (value) => typeof value === 'object' && value !== null && 'cashbackWasZeroAt' in value
  )
}

export const migrateHiddenTokens = (tokenPreferences: LegacyTokenPreference[]) => {
  return tokenPreferences
    .filter(({ isHidden }) => isHidden)
    .map(({ address, networkId, isHidden }) => ({
      address,
      networkId,
      isHidden
    }))
}

export const migrateCustomTokens = (tokenPreferences: LegacyTokenPreference[]) => {
  return tokenPreferences
    .filter(({ standard }) => !!standard)
    .map(({ address, standard, networkId }) => ({
      address,
      standard,
      networkId
    }))
}
