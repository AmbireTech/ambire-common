import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { Account, AccountId, AccountPreferences } from '../../interfaces/account'
import { Key, KeystoreSeed, StoredKey } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { CashbackStatus, LegacyCashbackStatus } from '../../interfaces/selectedAccount'
import { Storage } from '../../interfaces/storage'
import { getUniqueAccountsArray } from '../../libs/account/account'
import { NetworksWithPositionsByAccounts } from '../../libs/defiPositions/types'
import {
  CustomToken,
  LegacyTokenPreference,
  TokenPreference
} from '../../libs/portfolio/customToken'
import {
  AccountAssetsState as PortfolioAccountAssetsState,
  PreviousHintsStorage
} from '../../libs/portfolio/interfaces'
import {
  getShouldMigrateKeystoreSeedsWithoutHdPath,
  migrateCustomTokens,
  migrateHiddenTokens
} from '../../libs/storage/storage'

type StorageType = {
  migrations: string[]
  networks: Network[]
  accounts: Account[]
  accountPreferences?: { [key: AccountId]: AccountPreferences }
  networksWithAssetsByAccount: { [accountId: string]: PortfolioAccountAssetsState }
  networksWithPositionsByAccounts: NetworksWithPositionsByAccounts
  tokenPreferences: TokenPreference[]
  customTokens: CustomToken[]
  previousHints: PreviousHintsStorage
  keyPreferences: { addr: Key['addr']; type: Key['type']; label: string }[]
  keystoreKeys: StoredKey[]
  keystoreSeeds: string[] | KeystoreSeed[]
  cashbackStatusByAccount: Record<
    Account['addr'],
    CashbackStatus | LegacyCashbackStatus | null | undefined
  >
}

export class StorageController {
  #storageAPI: Storage

  #storage: StorageType = {
    migrations: [],
    networks: [],
    accounts: [],
    accountPreferences: undefined,
    networksWithAssetsByAccount: {},
    networksWithPositionsByAccounts: {},
    tokenPreferences: [],
    customTokens: [],
    previousHints: { fromExternalAPI: {}, learnedTokens: {}, learnedNfts: {} },
    keyPreferences: [],
    keystoreKeys: [],
    keystoreSeeds: [],
    cashbackStatusByAccount: {}
  }

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  #updateQueue: Promise<void> = Promise.resolve()

  constructor(storage: Storage) {
    this.#storageAPI = storage
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#initialLoadPromise = this.#load()
  }

  async #load() {
    const storage = await this.#storageAPI.get(null, {})
    if (!Object.keys(storage).length) return

    Object.keys(storage).forEach((key) => {
      this.#storage[key as keyof StorageType] = storage[key]
    })

    try {
      // IMPORTANT: should be ordered by versions
      await this.#migrateAccountPreferencesToAccounts() // As of version 4.25.0
      await this.#migrateKeystoreSeedsWithoutHdPathTemplate() // As of version v4.33.0
      await this.#migrateKeyPreferencesToKeystoreKeys() // As of version v4.33.0
      await this.#migrateKeyMetaNullToKeyMetaCreatedAt() // As of version v4.33.0
      await this.#clearHumanizerMetaObjectFromStorage() // As of version v4.34.0
      await this.#migrateTokenPreferences() // As of version 4.51.0
      await this.#migrateCashbackStatusToNewFormat() // As of version 4.53.0
    } catch (error) {
      console.error('Storage migration error: ', error)
    }

    const storageAfterMigrations = await this.#storageAPI.get(null, {})
    Object.keys(storageAfterMigrations).forEach((key) => {
      this.#storage[key as keyof StorageType] = storage[key]
    })
  }

  // As of version 4.25.0, a new Account interface has been introduced,
  // merging the previously separate Account and AccountPreferences interfaces.
  // This change requires a migration due to the introduction of a new controller, AccountsController,
  // which now manages both accounts and their preferences.
  async #migrateAccountPreferencesToAccounts() {
    if (!this.#storage.accountPreferences) return

    const accounts = getUniqueAccountsArray(
      this.#storage.accounts.map((a) => {
        return {
          ...a,
          // @ts-ignore
          preferences: this.#storage.accountPreferences[a.addr] || {
            label: DEFAULT_ACCOUNT_LABEL,
            pfp: a.addr
          }
        }
      })
    )

    await this.#storageAPI.set('accounts', accounts)
    await this.#storageAPI.remove('accountPreferences')
  }

  // As of version v4.33.0, user can change the HD path when importing a seed.
  // Migration is needed because previously the HD path was not stored,
  // and the default used was `BIP44_STANDARD_DERIVATION_TEMPLATE`.
  async #migrateKeystoreSeedsWithoutHdPathTemplate() {
    if (!getShouldMigrateKeystoreSeedsWithoutHdPath(this.#storage.keystoreSeeds)) return

    const keystoreSeeds = this.#storage.keystoreSeeds.map((seed) => ({
      seed,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    }))

    await this.#storageAPI.set('keystoreSeeds', keystoreSeeds)
  }

  // As of version 4.33.0, we no longer store the key preferences in a separate object called keyPreferences in the storage.
  // Migration is needed because each preference (like key label)
  // is now part of the Key interface and managed by the KeystoreController.
  async #migrateKeyPreferencesToKeystoreKeys() {
    const shouldMigrateKeyPreferencesToKeystoreKeys = this.#storage.keyPreferences.length > 0

    if (!shouldMigrateKeyPreferencesToKeystoreKeys) return

    const keystoreKeys = this.#storage.keystoreKeys.map((key) => {
      if (key.label) return key

      const keyPref = this.#storage.keyPreferences.find(
        (k) => k.addr === key.addr && k.type === key.type
      )

      if (keyPref) return { ...key, label: keyPref.label }

      return key
    })

    await this.#storageAPI.set('keystoreKeys', keystoreKeys)
    await this.#storageAPI.remove('keyPreferences')
  }

  // As of version 4.33.0, we introduced createdAt prop to the Key interface to help with sorting and add more details for the Keys.
  async #migrateKeyMetaNullToKeyMetaCreatedAt() {
    const keystoreKeys = this.#storage.keystoreKeys.map((key) => {
      if (!key.meta) return { ...key, meta: { createdAt: null } } as StoredKey
      if (!key.meta.createdAt)
        return { ...key, meta: { ...key.meta, createdAt: null } } as StoredKey

      return key
    })
    await this.#storageAPI.set('keystoreKeys', keystoreKeys)
  }

  // As of version v4.34.0 HumanizerMetaV2 in storage is no longer needed. It was
  // used for persisting learnt data from async operations, triggered by the
  // humanization process.
  async #clearHumanizerMetaObjectFromStorage() {
    await this.#storageAPI.remove('HumanizerMetaV2')
  }

  // As of version 4.53.0, cashback status information has been introduced.
  // Previously, cashback statuses were stored as separate objects per account.
  // Now, they are normalized under a single structure for simplifying.
  // Migration is needed to transform existing data into the new format.
  async #migrateCashbackStatusToNewFormat() {
    const cashbackStatusByAccount = Object.fromEntries(
      Object.entries(this.#storage.cashbackStatusByAccount).map(([accountId, status]) => {
        if (typeof status === 'string') {
          return [accountId, status as CashbackStatus]
        }

        if (typeof status === 'object' && status !== null) {
          const { cashbackWasZeroAt, firstCashbackReceivedAt, firstCashbackSeenAt } = status

          if (
            cashbackWasZeroAt &&
            firstCashbackReceivedAt === null &&
            firstCashbackSeenAt === null
          ) {
            return [accountId, 'no-cashback']
          }

          if (
            cashbackWasZeroAt === null &&
            firstCashbackReceivedAt &&
            firstCashbackSeenAt === null
          ) {
            return [accountId, 'unseen-cashback']
          }

          if (cashbackWasZeroAt === null && firstCashbackReceivedAt && firstCashbackSeenAt) {
            return [accountId, 'seen-cashback']
          }
        }

        return [accountId, 'seen-cashback']
      })
    )
    await this.#storageAPI.set('cashbackStatusByAccount', cashbackStatusByAccount)
  }

  // As of version 4.51.0, migrate legacy token preferences to token preferences and custom tokens
  async #migrateTokenPreferences() {
    if (
      (this.#storage.tokenPreferences as LegacyTokenPreference[]).some(
        ({ symbol, decimals }) => !!symbol || !!decimals
      )
    ) {
      await this.#storageAPI.set(
        'tokenPreferences',
        migrateHiddenTokens(this.#storage.tokenPreferences as LegacyTokenPreference[])
      )
      await this.#storageAPI.set(
        'customTokens',
        migrateCustomTokens(this.#storage.tokenPreferences as LegacyTokenPreference[])
      )
    }
  }

  async get(key: string | null, defaultValue?: any) {
    await this.#initialLoadPromise

    if (key === null) return this.#storage

    return (this.#storage as any)[key] ?? defaultValue
  }

  async set(key: string, value: any) {
    await this.#initialLoadPromise
    this.#updateQueue = this.#updateQueue.then(async () => {
      try {
        await this.#storageAPI.set(key, value)
      } catch (err) {
        console.error(`Failed to set storage key "${key}":`, err)
      }
    })
    await this.#updateQueue
  }

  async remove(key: string) {
    await this.#initialLoadPromise
    this.#updateQueue = this.#updateQueue.then(async () => {
      try {
        await this.#storageAPI.remove(key)
      } catch (err) {
        console.error(`Failed to remove storage key "${key}":`, err)
      }
    })
    await this.#updateQueue
  }
}
