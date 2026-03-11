import fetch from 'node-fetch'

import { MainController } from '../../src/controllers/main/main'
import { StorageController } from '../../src/controllers/storage/storage'
import * as accountStateLib from '../../src/libs/accountState/accountState'
import { KeystoreSigner } from '../../src/libs/keystoreSigner/keystoreSigner'
import { relayerUrl, velcroUrl } from '../config'
import { produceMemoryStore } from '../helpers'
import { mockUiManager } from './ui'

import type { FeatureFlags } from '../../src/consts/featureFlags'
import type {
  ExternalSignerControllers,
  Key,
  KeystoreSignerType
} from '../../src/interfaces/keystore'
import type { Platform } from '../../src/interfaces/platform'
import type { Storage } from '../../src/interfaces/storage'

export interface MakeMainControllerOpts {
  /** Mock `getAccountState` to return `[]`, skipping real RPC calls. Default: `true`. */
  skipAccountStateLoad?: boolean
  /** Don't instantiate `ContinuousUpdatesController`, avoiding lingering timers. Default: `true`. */
  skipContinuousUpdates?: boolean
  /**
   * Await `mainCtrl.initialLoadPromise` before returning. Set to `false` when
   * using fake timers so you can apply post-construction mocks first. Default: `true`.
   */
  awaitInitialLoad?: boolean
  /** Also await `accounts.accountStateInitialLoadPromise` (ignored when `skipAccountStateLoad` is true). Default: `false`. */
  awaitAccountStates?: boolean
  /** Mock `portfolio.updateSelectedAccount` to a no-op, preventing real network calls on load. Default: `true`. */
  skipPortfolioUpdateOnLoad?: boolean
  /** Mock `domains.reverseLookup` to a no-op, preventing real domain resolution on load. Default: `true`. */
  skipDomainsResolveOnLoad?: boolean
  /** Override any `MainController` constructor params. */
  overrides?: {
    appVersion?: string
    platform?: Platform
    featureFlags?: Partial<FeatureFlags>
    liFiApiKey?: string
    bungeeApiKey?: string
    externalSignerControllers?: ExternalSignerControllers
    keystoreSigners?: Partial<{ [key in Key['type']]: KeystoreSignerType }>
    relayerUrl?: string
    velcroUrl?: string
  }
}

export interface MakeMainControllerResult {
  mainCtrl: MainController
  storage: Storage
  /** The `StorageController` passed to `initialSetStorage`. Note: `mainCtrl.storage` is a separate instance wrapping the same underlying map. */
  storageCtrl: StorageController
  /** Restores spies set up by the factory. Call in `afterEach`, or use `jest.restoreAllMocks()`. */
  restore: () => void
}

export const makeMainController = async (
  initialSetStorage?: (storageCtrl: StorageController) => Promise<void> | void,
  opts: MakeMainControllerOpts = {}
): Promise<MakeMainControllerResult> => {
  const {
    skipAccountStateLoad = true,
    skipContinuousUpdates = true,
    awaitInitialLoad = true,
    awaitAccountStates = true,
    skipPortfolioUpdateOnLoad = true,
    skipDomainsResolveOnLoad = true,
    overrides = {}
  } = opts

  const storage: Storage = produceMemoryStore()

  // Wrap in StorageController so the caller can pre-seed data via the high-level API.
  // We pass the same raw instance to MainController so both see the same data.
  const storageCtrl = new StorageController(storage)
  if (initialSetStorage) await initialSetStorage(storageCtrl)

  // Must be set up before MainController is constructed since AccountsController.#load()
  // fires from the constructor and unconditionally calls getAccountState.
  let accountStateSpy: jest.SpyInstance | undefined
  if (skipAccountStateLoad) {
    accountStateSpy = jest.spyOn(accountStateLib, 'getAccountState').mockResolvedValue([])
  }

  const featureFlags: Partial<FeatureFlags> = {
    withContinuousUpdatesController: !skipContinuousUpdates,
    ...overrides.featureFlags
  }

  const { uiManager } = mockUiManager()
  const mainCtrl = new MainController({
    appVersion: overrides.appVersion ?? '5.31.0',
    platform: overrides.platform ?? 'default',
    storageAPI: storage,
    fetch,
    relayerUrl: overrides.relayerUrl ?? relayerUrl,
    velcroUrl: overrides.velcroUrl ?? velcroUrl,
    liFiApiKey: overrides.liFiApiKey ?? '',
    bungeeApiKey: overrides.bungeeApiKey ?? '',
    featureFlags,
    keystoreSigners: overrides.keystoreSigners ?? { internal: KeystoreSigner },
    externalSignerControllers: overrides.externalSignerControllers ?? {},
    uiManager
  })

  // Applied synchronously before any async callbacks run, so the initial load
  // will use the mocked versions.
  if (skipPortfolioUpdateOnLoad) {
    mainCtrl.portfolio.updateSelectedAccount = jest.fn().mockResolvedValue(undefined)
  }
  if (skipDomainsResolveOnLoad) {
    mainCtrl.domains.reverseLookup = jest.fn().mockResolvedValue(undefined)
  }

  if (awaitInitialLoad) {
    await mainCtrl.initialLoadPromise
  }

  if (awaitAccountStates && !skipAccountStateLoad) {
    await mainCtrl.accounts.accountStateInitialLoadPromise
  }

  return {
    mainCtrl,
    storage,
    storageCtrl,
    restore: () => accountStateSpy?.mockRestore()
  }
}
