import { describe, expect, jest, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { Storage } from '../../interfaces/storage'
import { StorageController } from './storage'

const ALL_MIGRATION_KEYS = [
  'migrateNetworkPreferencesToNetworks',
  'migrateAccountPreferencesToAccounts',
  'migrateKeystoreSeedsWithoutHdPathTemplate',
  'migrateKeyPreferencesToKeystoreKeys',
  'migrateKeyMetaNullToKeyMetaCreatedAt',
  'clearHumanizerMetaObjectFromStorage',
  'migrateTokenPreferences',
  'removeDappSessions',
  'removeIsDefaultWalletStorageIfExist',
  'removeOnboardingStateStorageIfExist',
  'migrateNetworkIdToChainId',
  'migrateAccountsCleanupUsedOnNetworks',
  'migrateLegacyDappsToDappsV2',
  'cleanObsoleteNewlyCreatedFlagOnAccounts',
  'cleanupCashbackStatus',
  'removePhishingDetection',
  'removePhishingDetectionV2',
  'cleanUpEmailVaultStorage',
  'fixSelectedAccountDismissedBannerIdsType',
  'migrateDappsAddConnectionSources',
  'migrateDomainsCacheToNames',
  'migrateDappsAddMissingIds',
  'indexSentToHistoryFromAccountsOps'
]

// Wraps a memory store and counts how many times each key is read and how many
// writes/removes happen, so tests can assert the migration sweep is cheap.
function produceCountingStore() {
  const inner = produceMemoryStore()
  let getCounts: Record<string, number> = {}
  let setCount = 0
  let removeCount = 0

  const store: Storage = {
    get: ((key: string, defaultValue?: any) => {
      getCounts[key] = (getCounts[key] || 0) + 1
      return (inner.get as any)(key, defaultValue)
    }) as Storage['get'],
    set: (key, value) => {
      setCount += 1
      return inner.set(key, value)
    },
    remove: (key) => {
      removeCount += 1
      return inner.remove(key)
    }
  }

  return {
    store,
    reset() {
      getCounts = {}
      setCount = 0
      removeCount = 0
    },
    getCounts: () => getCounts,
    totalGets: () => Object.values(getCounts).reduce((a, b) => a + b, 0),
    setCount: () => setCount,
    removeCount: () => removeCount
  }
}

// Boots a controller on a store where every migration but the pending ones is already recorded,
// so only the migrations under test touch the given storage values.
async function bootWithPendingMigrations(
  pendingMigrationKeys: string[],
  values: Record<string, any>,
  storage: Storage = produceMemoryStore()
) {
  await storage.set(
    'passedMigrations',
    ALL_MIGRATION_KEYS.filter((key) => !pendingMigrationKeys.includes(key))
  )
  await Promise.all(Object.entries(values).map(([key, value]) => storage.set(key, value)))

  return new StorageController(storage)
}

describe('StorageController', () => {
  test('should init StorageController', async () => {
    const storageCtrl = new StorageController(produceMemoryStore())
    expect(storageCtrl).toBeDefined()
  })
  test('test should get correct state from storage after storage.set', async () => {
    const storageCtrl = new StorageController(produceMemoryStore())
    storageCtrl.set('migrations', ['1'])
    storageCtrl.set('migrations', ['1', '2'])
    expect(await storageCtrl.get('migrations', [])).toEqual(['1', '2'])
    storageCtrl.set('migrations', ['1', '2', '3'])
    storageCtrl.set('migrations', ['1', '2', '3', '4'])
    expect(await storageCtrl.get('migrations', [])).toEqual(['1', '2', '3', '4'])
  })
  test('test should get correct state from storage after storage.remove', async () => {
    const storageCtrl = new StorageController(produceMemoryStore())
    storageCtrl.set('migrations', ['1', '2', '3', '4'])
    expect(await storageCtrl.get('migrations', [])).toEqual(['1', '2', '3', '4'])
    storageCtrl.remove('migrations')
    expect(await storageCtrl.get('migrations', [])).toEqual([])
  })

  describe('migrateDappsAddConnectionSources', () => {
    const legacyConnected = {
      id: 'legacy-connected.com',
      name: 'Legacy Connected',
      description: '',
      url: 'https://legacy-connected.com',
      icon: null,
      category: null,
      tvl: null,
      twitter: null,
      geckoId: null,
      chainIds: [1],
      isConnected: true,
      isFeatured: false,
      isCustom: true,
      chainId: 1,
      favorite: false,
      blacklisted: 'VERIFIED'
    }
    const legacyDisconnected = {
      ...legacyConnected,
      id: 'legacy-disconnected.com',
      name: 'Legacy Disconnected',
      url: 'https://legacy-disconnected.com',
      isConnected: false
    }

    test('seeds connectedSources from legacy isConnected and persists', async () => {
      const memStorage: Storage = produceMemoryStore()
      // Mark the earlier dapps migration as done, so only the migration under test touches dappsV2.
      await memStorage.set('passedMigrations', ['migrateLegacyDappsToDappsV2'])
      await memStorage.set('dappsV2', [legacyConnected, legacyDisconnected])

      // Constructing the controller kicks off #loadMigrations; get() awaits it implicitly.
      const storageCtrl = new StorageController(memStorage)
      const migrated = await storageCtrl.get('dappsV2', [])

      const connected = (migrated as any[]).find((d) => d.id === 'legacy-connected.com')
      const disconnected = (migrated as any[]).find((d) => d.id === 'legacy-disconnected.com')
      expect(connected.connectedSources).toEqual(['injected'])
      expect(disconnected.connectedSources).toEqual([])

      const passed = await storageCtrl.get('passedMigrations', [])
      expect(passed).toContain('migrateDappsAddConnectionSources')
    })

    test('is a no-op for dapps that already have a consistent connectedSources', async () => {
      const memStorage: Storage = produceMemoryStore()
      await memStorage.set('passedMigrations', ['migrateLegacyDappsToDappsV2'])
      // isConnected: true is consistent with connectedSources: ['wc'] (length > 0), so untouched.
      const alreadyMigrated = { ...legacyConnected, connectedSources: ['wc'] }
      await memStorage.set('dappsV2', [alreadyMigrated])

      const storageCtrl = new StorageController(memStorage)
      const migrated = await storageCtrl.get('dappsV2', [])
      expect((migrated as any[])[0].connectedSources).toEqual(['wc'])
    })

    // BUG: a dapp that already had a connectedSources array but a stale isConnected (the two
    // drifted) used to slip through the migration untouched, leaving isConnected: true while
    // connectedSources: []. The UI shows it as connected (it reads isConnected) but permission
    // checks (which read connectedSources) force a reconnect on every request.
    test('reconciles a drifted record where isConnected disagrees with connectedSources', async () => {
      const memStorage: Storage = produceMemoryStore()
      await memStorage.set('passedMigrations', ['migrateLegacyDappsToDappsV2'])
      const drifted = { ...legacyConnected, isConnected: true, connectedSources: [] }
      await memStorage.set('dappsV2', [drifted])

      const storageCtrl = new StorageController(memStorage)
      const migrated = await storageCtrl.get('dappsV2', [])

      // connectedSources is the source of truth → empty means disconnected, isConnected follows.
      expect((migrated as any[])[0].connectedSources).toEqual([])
      expect((migrated as any[])[0].isConnected).toBe(false)
    })

    test('passedMigrations guard prevents the migration from running twice', async () => {
      const memStorage: Storage = produceMemoryStore()
      await memStorage.set('passedMigrations', ['migrateLegacyDappsToDappsV2'])
      await memStorage.set('dappsV2', [legacyConnected])

      // First boot: migration runs and seeds connectedSources.
      const first = new StorageController(memStorage)
      await first.get('dappsV2', [])
      const passed = await first.get('passedMigrations', [])
      expect(passed).toContain('migrateDappsAddConnectionSources')

      // Once recorded, the migration is skipped on the next boot — storage-level repair is
      // one-shot. The durable invariant guarantee for already-recorded installs is enforced at
      // read time in DappsController.#load (see dapps.test.ts), not by re-running this migration.
      const tampered = (await first.get('dappsV2', [])).map((d: any) => {
        const { connectedSources, ...rest } = d
        return rest
      })
      await first.set('dappsV2', tampered)

      const second = new StorageController(memStorage)
      const after = await second.get('dappsV2', [])
      expect((after as any[])[0].connectedSources).toBeUndefined()
    })
  })

  describe('migrateDomainsCacheToNames', () => {
    const ADDRESS = '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337'

    test('normalizes legacy per-service fields into the { names, avatar, expiry } shape', async () => {
      const memStorage: Storage = produceMemoryStore()
      await memStorage.set('domainsCache', {
        [ADDRESS]: {
          ens: 'elmoto.eth',
          namoshi: null,
          ensAvatar: 'https://something.com/avatar.png',
          updatedAt: 123
        }
      } as any)

      const storageCtrl = new StorageController(memStorage)
      const migrated: any = await storageCtrl.get('domainsCache', {})

      const entry = migrated[ADDRESS]
      expect(entry.names.ens).toBe('elmoto.eth')
      expect(entry.names.namoshi).toBe(null)
      expect(entry.avatar).toBe('https://something.com/avatar.png')
      expect(entry.updatedAt).toBe(123)
      // Legacy fields are gone after the migration.
      expect('ens' in entry).toBe(false)
      expect('ensAvatar' in entry).toBe(false)

      const passed = await storageCtrl.get('passedMigrations', [])
      expect(passed).toContain('migrateDomainsCacheToNames')
    })

    test('leaves an already-migrated entry untouched', async () => {
      const memStorage: Storage = produceMemoryStore()
      const current = {
        [ADDRESS]: {
          names: { ens: 'elmoto.eth', namoshi: null },
          avatar: null,
          createdAt: 1,
          updatedAt: 2
        }
      }
      await memStorage.set('domainsCache', current as any)

      const storageCtrl = new StorageController(memStorage)
      const migrated = await storageCtrl.get('domainsCache', {})
      expect(migrated).toEqual(current)
    })
  })

  describe('migrateDappsAddMissingIds', () => {
    const MIGRATION_KEY = 'migrateDappsAddMissingIds'
    const PASSED_BEFORE_THIS_MIGRATION = ALL_MIGRATION_KEYS.filter((key) => key !== MIGRATION_KEY)
    const UNISWAP_URL = 'https://app.uniswap.org/'
    const UNISWAP_ID = 'app.uniswap.org'
    const baseDapp = {
      name: 'Uniswap',
      description: '',
      url: UNISWAP_URL,
      icon: null,
      category: null,
      tvl: null,
      twitter: null,
      geckoId: null,
      chainIds: [],
      isConnected: false,
      connectedSources: [],
      isFeatured: false,
      isCustom: true,
      chainId: 1,
      favorite: false,
      blacklisted: 'VERIFIED'
    }

    const bootWithDapps = async (dapps: any[]) => {
      const memStorage: Storage = produceMemoryStore()
      await memStorage.set('passedMigrations', PASSED_BEFORE_THIS_MIGRATION)
      await memStorage.set('dappsV2', dapps)
      const storageCtrl = new StorageController(memStorage)
      const migrated = (await storageCtrl.get('dappsV2', [])) as any[]
      const passed = await storageCtrl.get('passedMigrations', [])
      return { migrated, passed }
    }

    test('derives the missing id from the url', async () => {
      const { migrated, passed } = await bootWithDapps([baseDapp])

      expect(migrated).toEqual([{ ...baseDapp, id: UNISWAP_ID }])
      expect(passed).toContain(MIGRATION_KEY)
    })

    test('drops an id-less record whose derived id belongs to an existing record', async () => {
      const existing = {
        ...baseDapp,
        id: UNISWAP_ID,
        name: 'Existing Uniswap',
        isConnected: true,
        connectedSources: ['injected']
      }
      const { migrated } = await bootWithDapps([baseDapp, existing])

      expect(migrated).toEqual([existing])
    })

    test('drops an id-less record when the existing id still carries a trailing dot', async () => {
      const existingWithTrailingDot = {
        ...baseDapp,
        id: `${UNISWAP_ID}.`,
        name: 'Existing Uniswap'
      }
      const { migrated } = await bootWithDapps([baseDapp, existingWithTrailingDot])

      expect(migrated).toEqual([existingWithTrailingDot])
    })

    test('keeps only the first of several id-less records that derive the same id', async () => {
      const first = { ...baseDapp, name: 'First Uniswap' }
      const second = { ...baseDapp, name: 'Second Uniswap', url: 'https://www.app.uniswap.org/' }
      const { migrated } = await bootWithDapps([first, second])

      expect(migrated).toEqual([{ ...first, id: UNISWAP_ID }])
    })

    test('drops an id-less record without a url, since no id can be derived for it', async () => {
      const withoutUrl: Partial<typeof baseDapp> = { ...baseDapp }
      delete withoutUrl.url
      const { migrated, passed } = await bootWithDapps([withoutUrl])

      expect(migrated).toEqual([])
      expect(passed).toContain(MIGRATION_KEY)
    })

    test('writes only the migration marker when every record already has an id', async () => {
      const withId = { ...baseDapp, id: UNISWAP_ID }
      const counting = produceCountingStore()
      await counting.store.set('passedMigrations', PASSED_BEFORE_THIS_MIGRATION)
      await counting.store.set('dappsV2', [withId])
      counting.reset()

      const storageCtrl = new StorageController(counting.store)
      const passed = await storageCtrl.get('passedMigrations', [])

      // The single write is the `passedMigrations` marker, `dappsV2` is left as it was.
      expect(counting.setCount()).toBe(1)
      expect(passed).toContain(MIGRATION_KEY)
      expect(await storageCtrl.get('dappsV2', [])).toEqual([withId])
    })
  })

  describe('migrateAccountPreferencesToAccounts', () => {
    const MIGRATION_KEY = 'migrateAccountPreferencesToAccounts'
    const ADDR_WITH_PREFS = '0x6ACAE5921ab897535D3989C7ba45c262D120dc16'
    const ADDR_WITHOUT_PREFS = '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337'
    // Accounts as stored before v4.25.0 - without `preferences`
    const legacyAccounts = [
      { addr: ADDR_WITH_PREFS, associatedKeys: [], initialPrivileges: [], creation: null },
      { addr: ADDR_WITHOUT_PREFS, associatedKeys: [], initialPrivileges: [], creation: null }
    ]
    const legacyAccountPreferences = {
      [ADDR_WITH_PREFS]: { label: 'My main account', pfp: ADDR_WITH_PREFS }
    }

    const produceLegacyStore = async () => {
      const memStorage: Storage = produceMemoryStore()
      await memStorage.set('accounts', legacyAccounts as any)
      await memStorage.set('accountPreferences', legacyAccountPreferences)
      return memStorage
    }

    test('moves the legacy preferences onto the accounts and removes `accountPreferences`', async () => {
      const storageCtrl = new StorageController(await produceLegacyStore())

      const accounts = await storageCtrl.get('accounts', [])
      expect(accounts.find((a) => a.addr === ADDR_WITH_PREFS)?.preferences).toEqual(
        legacyAccountPreferences[ADDR_WITH_PREFS]
      )
      expect(await storageCtrl.get('accountPreferences')).toBeUndefined()
      expect(await storageCtrl.get('passedMigrations', [])).toContain(MIGRATION_KEY)
    })

    test('falls back to the default label and pfp for an account without legacy preferences', async () => {
      const storageCtrl = new StorageController(await produceLegacyStore())

      const accounts = await storageCtrl.get('accounts', [])
      expect(accounts.find((a) => a.addr === ADDR_WITHOUT_PREFS)?.preferences).toEqual({
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: ADDR_WITHOUT_PREFS
      })
    })

    test('does not block the migrations that come after it', async () => {
      const memStorage = await produceLegacyStore()
      // Seeds stored as plain strings, as before v4.33.0
      await memStorage.set('keystoreSeeds', ['encrypted-seed'] as any)

      const storageCtrl = new StorageController(memStorage)

      expect(await storageCtrl.get('passedMigrations', [])).toEqual(ALL_MIGRATION_KEYS)
      expect(await storageCtrl.get('keystoreSeeds', [])).toEqual([
        { seed: 'encrypted-seed', hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE }
      ])
    })

    test('keeps the preferences an account already has over the legacy ones', async () => {
      const memStorage = await produceLegacyStore()
      const renamedAccount = {
        ...legacyAccounts[0],
        preferences: { label: 'Renamed after the update', pfp: ADDR_WITH_PREFS }
      }
      await memStorage.set('accounts', [renamedAccount, legacyAccounts[1]] as any)

      const storageCtrl = new StorageController(memStorage)

      const accounts = await storageCtrl.get('accounts', [])
      expect(accounts.find((a) => a.addr === ADDR_WITH_PREFS)?.preferences).toEqual(
        renamedAccount.preferences
      )
      expect(accounts.find((a) => a.addr === ADDR_WITHOUT_PREFS)?.preferences).toEqual({
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: ADDR_WITHOUT_PREFS
      })
    })

    test('leaves the accounts untouched when there are no legacy preferences', async () => {
      const memStorage: Storage = produceMemoryStore()
      const accounts = [
        { ...legacyAccounts[0], preferences: { label: 'Already migrated', pfp: ADDR_WITH_PREFS } }
      ]
      await memStorage.set('accounts', accounts as any)

      const storageCtrl = new StorageController(memStorage)

      expect(await storageCtrl.get('accounts', [])).toEqual(accounts)
    })
  })

  describe('migrateNetworkPreferencesToNetworks', () => {
    const MIGRATION_KEY = 'migrateNetworkPreferencesToNetworks'
    const CUSTOM_CHAIN_ID = 1234n
    const networkPreferences = {
      'my-custom-network': {
        chainId: CUSTOM_CHAIN_ID,
        name: 'My custom network',
        rpcUrls: ['https://rpc.my-custom-network.com'],
        nativeAssetSymbol: 'MCN'
      }
    }
    const findCustomNetwork = (networks: Record<string, any>) =>
      Object.values(networks).find((n) => n.chainId === CUSTOM_CHAIN_ID)

    test('moves the custom networks from the legacy preferences into the networks', async () => {
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], { networkPreferences })

      const networks = await storageCtrl.get('networks', {})
      expect(findCustomNetwork(networks)?.name).toBe('My custom network')
      expect(await storageCtrl.get('networkPreferences')).toBeUndefined()
      expect(await storageCtrl.get('passedMigrations', [])).toContain(MIGRATION_KEY)
    })

    // BUG: the custom networks used to be migrated only when no networks were stored. Since the
    // networks controller stores networks on every boot, a skipped run lost them for good.
    test('adds the missing custom networks without replacing the stored ones', async () => {
      const storedEthereum = {
        chainId: 1n,
        name: 'Ethereum',
        rpcUrls: ['https://rpc-chosen-by-the-user.com']
      }
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {
        networks: { '1': storedEthereum },
        networkPreferences
      })

      const networks = await storageCtrl.get('networks', {})
      expect(networks['1']).toEqual(storedEthereum)
      expect(findCustomNetwork(networks)?.name).toBe('My custom network')
      expect(await storageCtrl.get('networkPreferences')).toBeUndefined()
    })

    test('does not add a legacy network whose chain is already stored', async () => {
      const storedCustomNetwork = { chainId: CUSTOM_CHAIN_ID, name: 'Renamed after the update' }
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {
        networks: { [CUSTOM_CHAIN_ID.toString()]: storedCustomNetwork },
        networkPreferences
      })

      const networks = await storageCtrl.get('networks', {})
      expect(Object.values(networks).filter((n) => n.chainId === CUSTOM_CHAIN_ID)).toEqual([
        storedCustomNetwork
      ])
    })
  })

  describe('migrateKeystoreSeedsWithoutHdPathTemplate', () => {
    const MIGRATION_KEY = 'migrateKeystoreSeedsWithoutHdPathTemplate'
    const seedInNewShape = {
      id: 'seed-2',
      label: 'Recovery Phrase 2',
      seed: 'encrypted-seed-2',
      hdPathTemplate: "m/44'/60'/0'/0/<account>"
    }

    // BUG: a seed added in the new shape used to stop the legacy seeds from being migrated at all.
    test('migrates only the seeds still stored as plain strings', async () => {
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {
        keystoreSeeds: ['encrypted-legacy-seed', seedInNewShape]
      })

      expect(await storageCtrl.get('keystoreSeeds', [])).toEqual([
        { seed: 'encrypted-legacy-seed', hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE },
        seedInNewShape
      ])
    })

    test('writes only the migration marker when no seed is stored as a plain string', async () => {
      const counting = produceCountingStore()
      await counting.store.set('keystoreSeeds', [seedInNewShape])
      counting.reset()

      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {}, counting.store)
      const passed = await storageCtrl.get('passedMigrations', [])

      // 2 writes = the `passedMigrations` set up by the test + the migration marker
      expect(counting.setCount()).toBe(2)
      expect(passed).toContain(MIGRATION_KEY)
      expect(await storageCtrl.get('keystoreSeeds', [])).toEqual([seedInNewShape])
    })
  })

  describe('migrateTokenPreferences', () => {
    const MIGRATION_KEY = 'migrateTokenPreferences'
    const TOKEN_A = '0x0000000000000000000000000000000000000001'
    const TOKEN_B = '0x0000000000000000000000000000000000000002'
    const TOKEN_C = '0x0000000000000000000000000000000000000003'
    const legacyCustomToken = {
      address: TOKEN_A,
      networkId: 'ethereum',
      symbol: 'AAA',
      decimals: 18,
      standard: 'ERC20',
      isHidden: false
    }
    const legacyHiddenCustomToken = {
      address: TOKEN_B,
      networkId: 'ethereum',
      symbol: 'BBB',
      decimals: 6,
      standard: 'ERC20',
      isHidden: true
    }
    const migratedCustomTokenA = { address: TOKEN_A, standard: 'ERC20', networkId: 'ethereum' }
    const customTokenAddedLater = { address: TOKEN_C, standard: 'ERC20', chainId: 137n }
    const preferenceAddedLater = { address: TOKEN_C, chainId: 137n, isHidden: true }

    test('moves the legacy custom tokens and keeps only the hidden ones as preferences', async () => {
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {
        tokenPreferences: [legacyCustomToken, legacyHiddenCustomToken]
      })

      expect(await storageCtrl.get('customTokens', [])).toEqual([
        migratedCustomTokenA,
        { address: TOKEN_B, standard: 'ERC20', networkId: 'ethereum' }
      ])
      expect(await storageCtrl.get('tokenPreferences', [])).toEqual([
        { address: TOKEN_B, networkId: 'ethereum', isHidden: true }
      ])
    })

    // BUG: the custom tokens and preferences stored in the meantime used to be overwritten.
    test('merges into the custom tokens and preferences stored in the meantime', async () => {
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {
        tokenPreferences: [preferenceAddedLater, legacyCustomToken],
        customTokens: [customTokenAddedLater]
      })

      expect(await storageCtrl.get('customTokens', [])).toEqual([
        customTokenAddedLater,
        migratedCustomTokenA
      ])
      expect(await storageCtrl.get('tokenPreferences', [])).toEqual([preferenceAddedLater])
    })

    // The custom tokens are stored first, so an interrupted run leaves the legacy preferences behind
    test('does not duplicate the custom tokens when re-run after an interruption', async () => {
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {
        tokenPreferences: [legacyCustomToken],
        customTokens: [migratedCustomTokenA]
      })

      expect(await storageCtrl.get('customTokens', [])).toEqual([migratedCustomTokenA])
      expect(await storageCtrl.get('tokenPreferences', [])).toEqual([])
    })

    test('writes only the migration marker when there are no legacy preferences', async () => {
      const counting = produceCountingStore()
      const storageCtrl = await bootWithPendingMigrations(
        [MIGRATION_KEY],
        { tokenPreferences: [preferenceAddedLater], customTokens: [customTokenAddedLater] },
        counting.store
      )
      counting.reset()
      await storageCtrl.get('passedMigrations', [])

      expect(counting.setCount()).toBe(1)
      expect(await storageCtrl.get('tokenPreferences', [])).toEqual([preferenceAddedLater])
      expect(await storageCtrl.get('customTokens', [])).toEqual([customTokenAddedLater])
    })
  })

  describe('migrateNetworkIdToChainId', () => {
    const MIGRATION_KEY = 'migrateNetworkIdToChainId'
    const ACCOUNT = '0x6ACAE5921ab897535D3989C7ba45c262D120dc16'
    const TOKEN_A = '0x0000000000000000000000000000000000000001'
    const TOKEN_B = '0x0000000000000000000000000000000000000002'
    const legacyEthereum = { id: 'ethereum', chainId: 1n, name: 'Ethereum' }
    const ethereum = { chainId: 1n, name: 'Ethereum' }
    const polygon = { chainId: 137n, name: 'Polygon' }

    const legacyValues = {
      networks: { ethereum: legacyEthereum },
      previousHints: {
        learnedTokens: { ethereum: { [TOKEN_A]: null } },
        learnedNfts: {},
        fromExternalAPI: {}
      },
      customTokens: [{ address: TOKEN_A, standard: 'ERC20', networkId: 'ethereum' }],
      tokenPreferences: [{ address: TOKEN_B, networkId: 'ethereum', isHidden: true }],
      networksWithAssetsByAccount: { [ACCOUNT]: { ethereum: { blockNumber: 1 } } },
      accountsOps: { [ACCOUNT]: { ethereum: [{ txnId: '0x01', networkId: 'ethereum' }] } },
      signedMessages: { [ACCOUNT]: [{ fromActionId: 1, networkId: 'ethereum' }] }
    }
    const expectedMigratedValues = {
      networks: { '1': ethereum },
      previousHints: {
        learnedTokens: { '1': { [TOKEN_A]: null } },
        learnedNfts: {},
        fromExternalAPI: {}
      },
      customTokens: [{ address: TOKEN_A, standard: 'ERC20', chainId: 1n }],
      tokenPreferences: [{ address: TOKEN_B, isHidden: true, chainId: 1n }],
      networksWithAssetsByAccount: { [ACCOUNT]: { '1': { blockNumber: 1 } } },
      accountsOps: { [ACCOUNT]: { '1': [{ txnId: '0x01', chainId: 1n }] } },
      signedMessages: { [ACCOUNT]: [{ fromActionId: 1, chainId: 1n }] }
    }
    const readMigratedValues = async (storageCtrl: StorageController) =>
      Object.fromEntries(
        await Promise.all(
          Object.keys(expectedMigratedValues).map(async (key) => [
            key,
            await storageCtrl.get(key as any)
          ])
        )
      )

    test('moves the data stored under networkIds to chainIds', async () => {
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], legacyValues)

      expect(await readMigratedValues(storageCtrl)).toEqual(expectedMigratedValues)
      expect(await storageCtrl.get('passedMigrations', [])).toContain(MIGRATION_KEY)
    })

    // BUG: data already stored under chainIds used to be keyed under "undefined" and assigned to
    // a random network, losing the activity history and moving tokens to the wrong network.
    test('writes only the migration marker when the data is already stored under chainIds', async () => {
      const counting = produceCountingStore()
      const storageCtrl = await bootWithPendingMigrations(
        [MIGRATION_KEY],
        expectedMigratedValues,
        counting.store
      )
      counting.reset()
      await storageCtrl.get('passedMigrations', [])

      expect(counting.setCount()).toBe(1)
      expect(await readMigratedValues(storageCtrl)).toEqual(expectedMigratedValues)
    })

    test('migrates only the legacy entries when both shapes are stored', async () => {
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {
        // The networks controller re-keys the networks by chainId, but keeps their legacy `id`
        networks: { '1': legacyEthereum, '137': polygon },
        customTokens: [
          { address: TOKEN_A, standard: 'ERC20', networkId: 'ethereum' },
          { address: TOKEN_B, standard: 'ERC20', chainId: 137n }
        ],
        accountsOps: {
          [ACCOUNT]: {
            ethereum: [{ txnId: '0x01', networkId: 'ethereum' }],
            '137': [{ txnId: '0x02', chainId: 137n }]
          }
        },
        signedMessages: {
          [ACCOUNT]: [
            { fromActionId: 1, networkId: 'ethereum' },
            { fromActionId: 2, chainId: 137n }
          ]
        }
      })

      expect(await storageCtrl.get('networks', {})).toEqual({ '1': ethereum, '137': polygon })
      expect(await storageCtrl.get('customTokens', [])).toEqual([
        { address: TOKEN_A, standard: 'ERC20', chainId: 1n },
        { address: TOKEN_B, standard: 'ERC20', chainId: 137n }
      ])
      expect(await storageCtrl.get('accountsOps', {})).toEqual({
        [ACCOUNT]: {
          '1': [{ txnId: '0x01', chainId: 1n }],
          '137': [{ txnId: '0x02', chainId: 137n }]
        }
      })
      expect(await storageCtrl.get('signedMessages', {})).toEqual({
        [ACCOUNT]: [
          { fromActionId: 1, chainId: 1n },
          { fromActionId: 2, chainId: 137n }
        ]
      })
    })

    test('keeps the entry already stored under the chainId over the legacy one', async () => {
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {
        networks: { '1': legacyEthereum },
        accountsOps: {
          [ACCOUNT]: {
            ethereum: [{ txnId: '0x01', networkId: 'ethereum' }],
            '1': [{ txnId: '0x02', chainId: 1n }]
          }
        }
      })

      expect(await storageCtrl.get('accountsOps', {})).toEqual({
        [ACCOUNT]: { '1': [{ txnId: '0x02', chainId: 1n }] }
      })
    })

    test('leaves an entry of a network without a legacy id as it is', async () => {
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {
        networks: { '1': legacyEthereum, '137': polygon },
        customTokens: [{ address: TOKEN_A, standard: 'ERC20', networkId: 'polygon' }]
      })

      expect(await storageCtrl.get('customTokens', [])).toEqual([
        { address: TOKEN_A, standard: 'ERC20', networkId: 'polygon' }
      ])
    })

    // BUG: the networks used to be stored first, without their legacy `id`, so an interrupted run
    // left the rest of the data impossible to migrate and the next run corrupted it.
    test('completes on the next boot when interrupted in the middle', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const inner = produceMemoryStore()
      let shouldInterrupt = true
      const interruptedStore: Storage = {
        get: inner.get,
        set: (key, value) => {
          if (key === 'accountsOps' && shouldInterrupt) {
            shouldInterrupt = false
            return Promise.reject(new Error('Interrupted'))
          }
          return inner.set(key, value)
        },
        remove: inner.remove
      }
      await inner.set(
        'passedMigrations',
        ALL_MIGRATION_KEYS.filter((key) => key !== MIGRATION_KEY)
      )
      await Promise.all(Object.entries(legacyValues).map(([key, value]) => inner.set(key, value)))

      const interrupted = new StorageController(interruptedStore)
      expect(await interrupted.get('passedMigrations', [])).not.toContain(MIGRATION_KEY)

      const next = new StorageController(inner)
      expect(await readMigratedValues(next)).toEqual(expectedMigratedValues)
      expect(await next.get('passedMigrations', [])).toContain(MIGRATION_KEY)
      consoleErrorSpy.mockRestore()
    })
  })

  describe('migrateLegacyDappsToDappsV2', () => {
    const MIGRATION_KEY = 'migrateLegacyDappsToDappsV2'
    const legacyDapp = {
      id: 'legacy.com',
      name: 'Legacy',
      description: 'Custom app automatically added when connected',
      url: 'https://legacy.com',
      icon: null,
      isConnected: true,
      isFeatured: false,
      chainId: 1,
      favorite: false
    }
    const storedDapp = {
      id: 'app.uniswap.org',
      name: 'Uniswap',
      description: '',
      url: 'https://app.uniswap.org',
      icon: null,
      category: 'Dexes',
      tvl: null,
      twitter: null,
      geckoId: null,
      chainIds: [1],
      isConnected: true,
      connectedSources: ['injected'],
      isFeatured: false,
      isCustom: false,
      chainId: 1,
      favorite: true,
      blacklisted: 'VERIFIED'
    }

    // BUG: without legacy dapps the stored dapps used to be replaced with an empty list, dropping
    // every connection and permission of the user.
    test('writes only the migration marker when there are no legacy dapps', async () => {
      const counting = produceCountingStore()
      const storageCtrl = await bootWithPendingMigrations(
        [MIGRATION_KEY],
        { dappsV2: [storedDapp] },
        counting.store
      )
      counting.reset()
      await storageCtrl.get('passedMigrations', [])

      expect(counting.setCount()).toBe(1)
      expect(await storageCtrl.get('dappsV2', [])).toEqual([storedDapp])
    })

    test('migrates the legacy dapps and removes them', async () => {
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {
        dapps: [legacyDapp]
      })

      expect(await storageCtrl.get('dappsV2', [])).toEqual([
        {
          ...legacyDapp,
          description: '',
          category: null,
          tvl: null,
          chainIds: [],
          isCustom: true,
          twitter: null,
          geckoId: null
        }
      ])
      expect(await storageCtrl.get('dapps')).toBeUndefined()
    })

    test('merges the legacy dapps into the stored ones, keeping the stored record of an id', async () => {
      const storedLegacyDapp = { ...storedDapp, id: legacyDapp.id, url: legacyDapp.url }
      const otherLegacyDapp = { ...legacyDapp, id: 'other.com', url: 'https://other.com' }
      const storageCtrl = await bootWithPendingMigrations([MIGRATION_KEY], {
        dapps: [legacyDapp, otherLegacyDapp],
        dappsV2: [storedLegacyDapp]
      })

      const dapps = await storageCtrl.get('dappsV2', [])
      expect(dapps.map((d) => d.id)).toEqual([legacyDapp.id, otherLegacyDapp.id])
      expect(dapps[0]).toEqual(storedLegacyDapp)
      expect(await storageCtrl.get('dapps')).toBeUndefined()
    })

    test('keeps id-less legacy dapps, so their ids get derived by the next migration', async () => {
      const { id, ...idLessLegacyDapp } = legacyDapp
      const storageCtrl = await bootWithPendingMigrations(
        [MIGRATION_KEY, 'migrateDappsAddMissingIds'],
        { dapps: [idLessLegacyDapp], dappsV2: [storedDapp] }
      )

      const dapps = await storageCtrl.get('dappsV2', [])
      expect(dapps.map((d) => d.id)).toEqual([storedDapp.id, id])
    })
  })

  describe('migration sweep performance', () => {
    test('a fully-migrated install reads only `passedMigrations` once and writes nothing', async () => {
      const counting = produceCountingStore()
      // Simulate an existing install where every migration has already run.
      await counting.store.set('passedMigrations', ALL_MIGRATION_KEYS)
      counting.reset()

      const storageCtrl = new StorageController(counting.store)
      // Awaiting any public get drains the migration sweep, then issues exactly
      // one extra `passedMigrations` read of its own.
      await storageCtrl.get('passedMigrations', [])

      // The sweep itself must not touch any data key, set, or remove anything.
      // 2 reads = 1 from the sweep + 1 from the get() above.
      expect(counting.getCounts().passedMigrations).toBe(2)
      expect(counting.totalGets()).toBe(2)
      expect(counting.setCount()).toBe(0)
      expect(counting.removeCount()).toBe(0)
    })

    test('a fresh install records every migration, then later boots become a single read', async () => {
      const counting = produceCountingStore()

      // First boot on an empty store: every migration runs (mostly no-ops on
      // empty data) and records itself in `passedMigrations`.
      const first = new StorageController(counting.store)
      const passed = await first.get('passedMigrations', [])
      expect([...passed].sort()).toEqual([...ALL_MIGRATION_KEYS].sort())

      // Second boot on the now-migrated store must be as cheap as the steady
      // state: one `passedMigrations` read by the sweep, no other reads/writes.
      counting.reset()
      const second = new StorageController(counting.store)
      await second.get('passedMigrations', [])

      expect(counting.getCounts().passedMigrations).toBe(2)
      expect(counting.totalGets()).toBe(2)
      expect(counting.setCount()).toBe(0)
      expect(counting.removeCount()).toBe(0)
    })

    test('the newly-guarded migrations do not run again once recorded', async () => {
      // These four previously had no `passedMigrations` guard and so read (and
      // some wrote) on every boot. Once recorded they must be skipped entirely.
      const counting = produceCountingStore()
      await counting.store.set('passedMigrations', ALL_MIGRATION_KEYS)
      counting.reset()

      const storageCtrl = new StorageController(counting.store)
      await storageCtrl.get('passedMigrations', [])

      // migrateKeyMetaNullToKeyMetaCreatedAt -> keystoreKeys (used to write it)
      expect(counting.getCounts().keystoreKeys).toBeUndefined()
      // removeIsDefaultWalletStorageIfExist -> isDefaultWallet
      expect(counting.getCounts().isDefaultWallet).toBeUndefined()
      // removeOnboardingStateStorageIfExist -> onboardingState
      expect(counting.getCounts().onboardingState).toBeUndefined()
      // clearHumanizerMetaObjectFromStorage -> HumanizerMetaV2 (used to remove it)
      expect(counting.setCount()).toBe(0)
      expect(counting.removeCount()).toBe(0)
    })
  })
})
