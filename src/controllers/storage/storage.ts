import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { IAccountPickerController } from '../../interfaces/accountPicker'
import { Dapp } from '../../interfaces/dapp'
/* eslint-disable no-restricted-syntax */
import { Statuses } from '../../interfaces/eventEmitter'
import { IKeystoreController, StoredKey } from '../../interfaces/keystore'
import { IStorageController, Storage, StorageProps } from '../../interfaces/storage'
import { getUniqueAccountsArray } from '../../libs/account/account'
import { getDappNameFromId } from '../../libs/dapps/helpers'
import { KeyIterator } from '../../libs/keyIterator/keyIterator'
import { LegacyTokenPreference } from '../../libs/portfolio/customToken'
import {
  getShouldMigrateKeystoreSeedsWithoutHdPath,
  migrateCustomTokens,
  migrateHiddenTokens,
  migrateNetworkPreferencesToNetworks
} from '../../libs/storage/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

export const STATUS_WRAPPED_METHODS = {
  associateAccountKeysWithLegacySavedSeedMigration: 'INITIAL'
} as const

export class StorageController extends EventEmitter implements IStorageController {
  #storage: Storage

  // Holds the initial load promise, so that one can wait until it completes
  #storageMigrationsPromise: Promise<void>

  #storageUpdateQueue: Promise<void> = Promise.resolve()

  #associateAccountKeysWithLegacySavedSeedMigrationPassed: boolean = false

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  constructor(storage: Storage) {
    super()

    this.#storage = storage
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storageMigrationsPromise = this.#loadMigrations()
  }

  async #loadMigrations() {
    try {
      // IMPORTANT: should be ordered by versions
      await this.#migrateNetworkPreferencesToNetworks() // As of version 4.24.0
      await this.#migrateAccountPreferencesToAccounts() // As of version 4.25.0
      await this.#migrateKeystoreSeedsWithoutHdPathTemplate() // As of version v4.33.0
      await this.#migrateKeyPreferencesToKeystoreKeys() // As of version v4.33.0
      await this.#migrateKeyMetaNullToKeyMetaCreatedAt() // As of version v4.33.0
      await this.#clearHumanizerMetaObjectFromStorage() // As of version v4.34.0
      await this.#migrateTokenPreferences() // As of version 4.51.0
      await this.#removeDappSessions() // As of version 4.55.0
      await this.#removeIsDefaultWalletStorageIfExist() // As of version 4.57.0
      await this.#removeOnboardingStateStorageIfExist() // As of version 4.59.0
      await this.#migrateNetworkIdToChainId()
      await this.#migrateAccountsCleanupUsedOnNetworks() // As of version 5.24.0
      await this.#migrateLegacyDappsToDappsV2() // As of version 5.30.0
      await this.#cleanObsoleteNewlyCreatedFlagOnAccounts() // As of version 5.30.0
      await this.#cleanupCashbackStatus() // As of version 5.32.0
    } catch (error) {
      console.error('Storage migration error: ', error)
    }
  }

  // As of version 4.24.0, a new Network interface has been introduced,
  // that replaces the old NetworkDescriptor, NetworkPreference, and CustomNetwork.
  // Previously, only NetworkPreferences were stored, with other network properties
  // being calculated in a getter each time the networks were needed.
  // Now, all network properties are pre-calculated and stored in a structured format: { [key: NetworkId]: Network } in the storage.
  // This function migrates the data from the old NetworkPreferences to the new structure
  // to ensure compatibility and prevent breaking the extension after updating to v4.24.0
  async #migrateNetworkPreferencesToNetworks() {
    const [passedMigrations, networks, networkPreferences] = await Promise.all([
      this.#storage.get('passedMigrations', []),
      this.#storage.get('networks', {}),
      this.#storage.get('networkPreferences')
    ])

    if (passedMigrations.includes('migrateNetworkPreferencesToNetworks')) return

    if (!Object.keys(networks).length && networkPreferences) {
      const migratedNetworks = await migrateNetworkPreferencesToNetworks(networkPreferences)

      await this.#storage.set('networks', migratedNetworks)
      await this.#storage.remove('networkPreferences')
    }

    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'migrateNetworkPreferencesToNetworks'])
    ])
  }

  // As of version 4.25.0, a new Account interface has been introduced,
  // merging the previously separate Account and AccountPreferences interfaces.
  // This change requires a migration due to the introduction of a new controller, AccountsController,
  // which now manages both accounts and their preferences.
  async #migrateAccountPreferencesToAccounts() {
    const [passedMigrations, accounts, accountPreferences] = await Promise.all([
      this.#storage.get('passedMigrations', []),
      this.#storage.get('accounts', []),
      this.#storage.get('accountPreferences')
    ])

    if (passedMigrations.includes('migrateAccountPreferencesToAccounts')) return

    if (accountPreferences) {
      const migratedAccounts = getUniqueAccountsArray(
        accounts.map((a: any) => {
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
      await this.#storage.set('accounts', migratedAccounts)
      await this.#storage.remove('accountPreferences')
    }

    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'migrateAccountPreferencesToAccounts'])
    ])
  }

  // As of version v4.33.0, user can change the HD path when importing a seed.
  // Migration is needed because previously the HD path was not stored,
  // and the default used was `BIP44_STANDARD_DERIVATION_TEMPLATE`.
  async #migrateKeystoreSeedsWithoutHdPathTemplate() {
    const [passedMigrations, keystoreSeeds] = await Promise.all([
      this.#storage.get('passedMigrations', []),
      this.#storage.get('keystoreSeeds', [])
    ])

    if (passedMigrations.includes('migrateKeystoreSeedsWithoutHdPathTemplate')) return

    if (getShouldMigrateKeystoreSeedsWithoutHdPath(keystoreSeeds)) {
      const migratedKeystoreSeeds = keystoreSeeds.map((seed) => ({
        seed,
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
      }))

      await this.#storage.set('keystoreSeeds', migratedKeystoreSeeds)
    }

    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'migrateKeystoreSeedsWithoutHdPathTemplate'])
    ])
  }

  // As of version 4.33.0, we no longer store the key preferences in a separate object called keyPreferences in the storage.
  // Migration is needed because each preference (like key label)
  // is now part of the Key interface and managed by the KeystoreController.
  async #migrateKeyPreferencesToKeystoreKeys() {
    const [passedMigrations, keyPreferences, keystoreKeys] = await Promise.all([
      this.#storage.get('passedMigrations', []),
      this.#storage.get('keyPreferences', []),
      this.#storage.get('keystoreKeys', [])
    ])

    if (passedMigrations.includes('migrateKeyPreferencesToKeystoreKeys')) return

    const shouldMigrateKeyPreferencesToKeystoreKeys = keyPreferences.length > 0
    if (shouldMigrateKeyPreferencesToKeystoreKeys) {
      const migratedKeystoreKeys = keystoreKeys.map((key) => {
        if (key.label) return key

        const keyPref = keyPreferences.find((k) => k.addr === key.addr && k.type === key.type)

        if (keyPref) return { ...key, label: keyPref.label }

        return key
      })

      await this.#storage.set('keystoreKeys', migratedKeystoreKeys)
      await this.#storage.remove('keyPreferences')
    }

    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'migrateKeyPreferencesToKeystoreKeys'])
    ])
  }

  // As of version 4.33.0, we introduced createdAt prop to the Key interface to help with sorting and add more details for the Keys.
  async #migrateKeyMetaNullToKeyMetaCreatedAt() {
    const [passedMigrations, keystoreKeys] = await Promise.all([
      this.#storage.get('passedMigrations', []),
      this.#storage.get('keystoreKeys', [])
    ])

    if (passedMigrations.includes('migrateKeyMetaNullToKeyMetaCreatedAt')) return

    const migratedKeystoreKeys = keystoreKeys.map((key) => {
      if (!key.meta) return { ...key, meta: { createdAt: null } } as StoredKey
      if (!key.meta.createdAt)
        return { ...key, meta: { ...key.meta, createdAt: null } } as StoredKey

      return key
    })
    await this.#storage.set('keystoreKeys', migratedKeystoreKeys)
    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'migrateKeyMetaNullToKeyMetaCreatedAt'])
    ])
  }

  // As of version v4.34.0 HumanizerMetaV2 in storage is no longer needed. It was
  // used for persisting learnt data from async operations, triggered by the
  // humanization process.
  async #clearHumanizerMetaObjectFromStorage() {
    await this.#storage.remove('HumanizerMetaV2')
  }

  // As of version 4.55.0 we no longer need the dappSessions in the storage so this migration removes them
  async #removeDappSessions() {
    const passedMigrations = await this.#storage.get('passedMigrations', [])
    if (passedMigrations.includes('removeDappSessions')) return

    await this.#storage.remove('dappSessions')
    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'removeDappSessions'])
    ])
  }

  // As of version 4.51.0, migrate legacy token preferences to token preferences and custom tokens
  async #migrateTokenPreferences() {
    const [passedMigrations, tokenPreferences] = await Promise.all([
      this.#storage.get('passedMigrations', []),
      this.#storage.get('tokenPreferences', [])
    ])

    if (passedMigrations.includes('migrateTokenPreferences')) return

    if (
      (tokenPreferences as LegacyTokenPreference[]).some(
        ({ symbol, decimals }) => !!symbol || !!decimals
      )
    ) {
      await this.#storage.set(
        'tokenPreferences',
        migrateHiddenTokens(tokenPreferences as LegacyTokenPreference[])
      )
      await this.#storage.set(
        'customTokens',
        migrateCustomTokens(tokenPreferences as LegacyTokenPreference[])
      )
    }

    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'migrateTokenPreferences'])
    ])
  }

  async #migrateNetworkIdToChainId() {
    const [
      passedMigrations,
      networks,
      previousHints,
      customTokens,
      tokenPreferences,
      networksWithAssetsByAccount,
      networksWithPositionsByAccounts,
      accountsOps,
      signedMessages
    ] = await Promise.all([
      this.#storage.get('passedMigrations', []),
      this.#storage.get('networks', {}),
      this.#storage.get('previousHints', []),
      this.#storage.get('customTokens', []),
      this.#storage.get('tokenPreferences', []),
      this.#storage.get('networksWithAssetsByAccount', {}),
      this.#storage.get('networksWithPositionsByAccounts', {}),
      this.#storage.get('accountsOps', {}),
      this.#storage.get('signedMessages', {})
    ])

    if (passedMigrations.includes('migrateNetworkIdToChainId')) return

    if (!Object.keys(networks).length) {
      await this.#storage.set('passedMigrations', [
        ...new Set([...passedMigrations, 'migrateNetworkIdToChainId'])
      ])

      return
    }

    const networkIdToChainId = Object.fromEntries(
      Object.values(networks).map(({ id, chainId }: any) => [id, chainId as bigint])
    )

    const migrateKeys = <T>(obj: Record<string, T>) =>
      Object.fromEntries(
        Object.entries(obj).map(([networkId, value]) => [networkIdToChainId[networkId], value])
      )

    const migratedPreviousHints = {
      learnedTokens: migrateKeys(previousHints.learnedTokens || {}),
      learnedNfts: migrateKeys(previousHints.learnedNfts || {}),
      fromExternalAPI: {} // No longer used
    }

    const migratedCustomTokens = customTokens.map(({ networkId, ...rest }: any) => ({
      ...rest,
      chainId: networkIdToChainId[networkId]
    }))

    const migratedTokenPreferences: { address: string; chainId: string; isHidden?: boolean }[] =
      tokenPreferences.map(({ networkId, ...rest }: any) => ({
        ...rest,
        chainId: networkIdToChainId[networkId]
      }))

    const migratedNetworksWithAssetsByAccount = Object.fromEntries(
      Object.entries(networksWithAssetsByAccount).map(([accountId, assetsState]) => [
        accountId,
        migrateKeys(assetsState)
      ])
    )

    const migratedNetworksWithPositionsByAccounts = Object.fromEntries(
      Object.entries(networksWithPositionsByAccounts).map(([accountId, networksWithPositions]) => [
        accountId,
        migrateKeys(networksWithPositions)
      ])
    )

    const migratedAccountsOps = Object.fromEntries(
      Object.entries(accountsOps).map(([accountId, opsByNetwork]) => [
        accountId,
        Object.fromEntries(
          Object.entries(opsByNetwork).map(([networkId, ops]) => {
            const chainId = networkIdToChainId[networkId]
            return [
              chainId,
              // eslint-disable-next-line @typescript-eslint/no-shadow
              ops.map(({ networkId, ...rest }: any) => ({
                ...rest,
                chainId // Migrate networkId inside SubmittedAccountOp
              }))
            ]
          })
        )
      ])
    )

    const migratedSignedMessages = Object.fromEntries(
      Object.entries(signedMessages).map(([accountId, messages]) => [
        accountId,
        messages.map(({ networkId, ...rest }: any) => ({
          ...rest,
          chainId: networkIdToChainId[networkId] // Migrate networkId inside SignedMessage
        }))
      ])
    )

    const migratedNetworks = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      Object.entries(networks).map(([_, { id, ...rest }]: any) => [rest.chainId.toString(), rest])
    )

    await this.#storage.set('networks', migratedNetworks)
    await this.#storage.set('previousHints', migratedPreviousHints)
    await this.#storage.set('customTokens', migratedCustomTokens)
    await this.#storage.set('tokenPreferences', migratedTokenPreferences)
    await this.#storage.set('networksWithAssetsByAccount', migratedNetworksWithAssetsByAccount)
    await this.#storage.set(
      'networksWithPositionsByAccounts',
      migratedNetworksWithPositionsByAccounts
    )
    await this.#storage.set('accountsOps', migratedAccountsOps)
    await this.#storage.set('signedMessages', migratedSignedMessages)
    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'migrateNetworkIdToChainId'])
    ])
  }

  // As of version 4.57.0, we the Ambire wallet is always the default wallet, so we no longer need 'isDefaultWallet' in the storage.
  async #removeIsDefaultWalletStorageIfExist() {
    const isDefaultWalletStorageSet = await this.#storage.get('isDefaultWallet', undefined)

    if (isDefaultWalletStorageSet !== undefined) {
      await this.#storage.remove('isDefaultWallet')
    }
  }

  // As of version 4.59.0. the onboarding flow (stories) has been removed, we no longer need 'onboardingState' in the storage.
  async #removeOnboardingStateStorageIfExist() {
    const isOnboardingStateExists = await this.#storage.get('onboardingState', undefined)

    if (isOnboardingStateExists !== undefined) {
      await this.#storage.remove('onboardingState')
    }
  }

  async get<K extends keyof StorageProps | string>(
    key: K,
    defaultValue?: any
  ): Promise<K extends keyof StorageProps ? StorageProps[K] : any> {
    await this.#storageMigrationsPromise
    await this.#storageUpdateQueue

    return this.#storage.get(key, defaultValue)
  }

  async set(key: string, value: any) {
    await this.#storageMigrationsPromise
    this.#storageUpdateQueue = this.#storageUpdateQueue.then(async () => {
      try {
        await this.#storage.set(key, value)
      } catch (err) {
        console.error(`Failed to set storage key "${key}":`, err)
      }
    })
    await this.#storageUpdateQueue
  }

  async remove(key: string) {
    await this.#storageMigrationsPromise
    this.#storageUpdateQueue = this.#storageUpdateQueue.then(async () => {
      try {
        await this.#storage.remove(key)
      } catch (err) {
        console.error(`Failed to remove storage key "${key}":`, err)
      }
    })
    await this.#storageUpdateQueue
  }

  // As of version 5.1.2, migrate account keys to be associated with the legacy saved seed
  async #associateAccountKeysWithLegacySavedSeedMigration(
    accountPickerInitFn: () => IAccountPickerController,
    keystore: IKeystoreController,
    onSuccess: () => Promise<void>
  ) {
    if (this.#associateAccountKeysWithLegacySavedSeedMigrationPassed) return

    const [passedMigrations, keystoreSeeds, keystoreKeys] = await Promise.all([
      this.#storage.get('passedMigrations', []),
      this.#storage.get('keystoreSeeds', []),
      this.#storage.get('keystoreKeys', [])
    ])

    if (passedMigrations.includes('associateAccountKeysWithLegacySavedSeedMigration')) return

    const savedSeed = keystoreSeeds.find((s) => !s.id || s.id === 'legacy-saved-seed')

    if (!savedSeed) {
      this.#associateAccountKeysWithLegacySavedSeedMigrationPassed = true
      return
    }

    const keystoreSavedSeed = await keystore.getSavedSeed('legacy-saved-seed')

    const keyIterator = new KeyIterator(keystoreSavedSeed.seed, keystoreSavedSeed.seedPassphrase)
    const accountPicker = accountPickerInitFn()
    await accountPicker.setInitParams({
      keyIterator,
      hdPathTemplate: keystoreSavedSeed.hdPathTemplate,
      pageSize: 10,
      shouldAddNextAccountAutomatically: false,
      shouldGetAccountsUsedOnNetworks: false,
      shouldSearchForLinkedAccounts: true
    })
    await accountPicker.init()
    const makeKeyMapId = (k: { addr: string; type: string }) => `${k.addr}:${k.type}`

    // Keep all keys, keyed by composite key
    const updatedKeyMap = new Map(keystoreKeys.map((k) => [makeKeyMapId(k), { ...k }]))

    let page = 1
    while (page <= 10) {
      // eslint-disable-next-line no-await-in-loop
      await accountPicker.setPage({ page })
      // eslint-disable-next-line no-await-in-loop
      await accountPicker.findAndSetLinkedAccountsPromise

      const matchingAddresses = accountPicker.allKeysOnPage.filter((k) =>
        updatedKeyMap.has(`${k}:internal`)
      )

      if (matchingAddresses.length === 0) break

      for (const addr of matchingAddresses) {
        // Only modify keys with type === 'internal' and matching addr
        const matchingInternalKeys = keystoreKeys.filter(
          (k) => k.addr === addr && k.type === 'internal'
        )

        for (const key of matchingInternalKeys) {
          const compositeKey = makeKeyMapId(key)
          const storedKey = updatedKeyMap.get(compositeKey)
          if (storedKey) {
            storedKey.meta = { ...storedKey.meta, fromSeedId: keystoreSavedSeed.id }
            updatedKeyMap.set(compositeKey, storedKey)
          }
        }
      }

      page++
    }

    await accountPicker.reset()
    accountPicker.destroy()

    const updatedKeystoreKeys = Array.from(updatedKeyMap.values())

    await this.#storage.set('keystoreKeys', updatedKeystoreKeys)
    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'associateAccountKeysWithLegacySavedSeedMigration'])
    ])
    this.#associateAccountKeysWithLegacySavedSeedMigrationPassed = true
    await onSuccess()
  }

  async associateAccountKeysWithLegacySavedSeedMigration(
    accountPickerInitFn: () => IAccountPickerController,
    keystore: IKeystoreController,
    onSuccess: () => Promise<void>
  ) {
    await this.withStatus(
      'associateAccountKeysWithLegacySavedSeedMigration',
      () =>
        this.#associateAccountKeysWithLegacySavedSeedMigration(
          accountPickerInitFn,
          keystore,
          onSuccess
        ),
      true
    )
  }

  /**
   * As of version 5.24.0, due to a bug - AccountPicker controller was wrongly
   * saving `usedOnNetworks` on the accounts, which should NOT get persisted -
   * it was causing side effects especially when the accounts were unused and
   * then gradually getting used on more networks.
   */
  async #migrateAccountsCleanupUsedOnNetworks() {
    const [passedMigrations, accounts] = await Promise.all([
      this.#storage.get('passedMigrations', []),
      this.#storage.get('accounts', [])
    ])

    if (passedMigrations.includes('migrateAccountsCleanupUsedOnNetworks')) return

    // @ts-ignore-next-line yes, `usedOnNetworks` should NOT exist, but it was, because of a bug
    const shouldCleanupUsedOnNetworks = accounts.some((a) => a.usedOnNetworks)
    if (shouldCleanupUsedOnNetworks) {
      await this.#storage.set(
        'accounts',
        accounts.map((acc) =>
          // destructure and re-build to remove the `usedOnNetworks` property
          'usedOnNetworks' in acc ? (({ usedOnNetworks, ...rest }) => ({ ...rest }))(acc) : acc
        )
      )
    }

    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'migrateAccountsCleanupUsedOnNetworks'])
    ])
  }

  // As of version 5.30.0, we've introduced an extended dynamic dapp catalog.
  // This method migrates legacy dapp data to the new format and clears outdated storage.
  async #migrateLegacyDappsToDappsV2() {
    const [passedMigrations, dapps] = await Promise.all([
      this.#storage.get('passedMigrations', []),
      this.#storage.get('dapps', [])
    ])

    if (passedMigrations.includes('migrateLegacyDappsToDappsV2')) return

    const migratedDapps: Dapp[] = []
    dapps.forEach((dapp: Dapp) => {
      const updatedDapp: Dapp = {
        ...dapp,
        name: dapp.name || getDappNameFromId(dapp.id),
        description: dapp?.description?.startsWith('Custom app automatically added')
          ? ''
          : dapp.description,
        category: null,
        tvl: null,
        chainIds: [],
        isConnected: dapp?.isConnected || false,
        isFeatured: dapp.isFeatured || false,
        isCustom: !!dapp?.description?.startsWith('Custom app automatically added'),
        twitter: null,
        geckoId: null
      }
      migratedDapps.push(updatedDapp)
    })

    await this.#storage.set('dappsV2', migratedDapps)
    await this.#storage.remove('dapps')
    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'migrateLegacyDappsToDappsV2'])
    ])
  }

  /**
   * As of version 5.30.0, the "newlyAdded" is no longer part of the account
   * interface and moreover - even before this v - it was no longer used anywhere.
   */
  async #cleanObsoleteNewlyCreatedFlagOnAccounts() {
    const [passedMigrations, accounts] = await Promise.all([
      this.#storage.get('passedMigrations', []),
      this.#storage.get('accounts', [])
    ])

    if (passedMigrations.includes('cleanObsoleteNewlyCreatedFlagOnAccounts')) return

    const shouldCleanupNewlyCreatedFlags = accounts.some((a) => 'newlyCreated' in a)
    if (shouldCleanupNewlyCreatedFlags) {
      await this.#storage.set(
        'accounts',
        accounts.map((acc) =>
          // destructure and re-build to remove the `newlyCreated` property
          'newlyCreated' in acc ? (({ newlyCreated, ...rest }) => ({ ...rest }))(acc) : acc
        )
      )
    }

    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'cleanObsoleteNewlyCreatedFlagOnAccounts'])
    ])
  }

  // As of version 5.32.0, we no longer need to keep cashback status by account in the storage
  async #cleanupCashbackStatus() {
    const [passedMigrations] = await Promise.all([this.#storage.get('passedMigrations', [])])

    if (passedMigrations.includes('cleanupCashbackStatus')) return

    await this.#storage.remove('cashbackStatusByAccount')
    await this.#storage.set('passedMigrations', [
      ...new Set([...passedMigrations, 'cleanupCashbackStatus'])
    ])
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
