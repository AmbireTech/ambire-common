import { IContractInfoController, Selectors } from '@/interfaces/contractInfo'
import { IEventEmitterRegistryController } from '@/interfaces/eventEmitter'
import { IFeatureFlagsController } from '@/interfaces/featureFlags'
import { Fetch } from '@/interfaces/fetch'
import { IStorageController } from '@/interfaces/storage'
import { fetchWithTimeout } from '@/utils/fetch'
import wait from '@/utils/wait'

import EventEmitter from '../eventEmitter/eventEmitter'

export const FUNCTION_SELECTORS_STORAGE_KEY = 'functionSelectors'
export const SELECTOR_SUCCESS_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000
export const SELECTOR_NOT_FOUND_DEADLINE_MS = SELECTOR_SUCCESS_DEADLINE_MS
export const SELECTOR_ERROR_DEADLINE_MS = 5 * 60 * 1000

// The ContractInfoController is responsible for getting function selectors for contracts
export class ContractInfoController extends EventEmitter implements IContractInfoController {
  #fetch: Fetch

  #storage: IStorageController

  #debounceBufferForSelectors: Set<string> = new Set()

  #debounceSelectorFetchPromise?: Promise<void>

  #featureFlag: IFeatureFlagsController

  #cenaUrl: string

  selectors: Selectors = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor({
    eventEmitterRegistry,
    fetch,
    storage,
    featureFlags,
    cenaUrl = 'https://cena.ambire.com'
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    fetch: Fetch
    storage: IStorageController
    featureFlags: IFeatureFlagsController
    cenaUrl?: string
  }) {
    super(eventEmitterRegistry)

    this.#fetch = fetch
    this.#storage = storage
    this.#featureFlag = featureFlags
    this.#cenaUrl = cenaUrl

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  get isReady() {
    return !this.initialLoadPromise
  }

  async #load() {
    this.selectors = await this.#storage.get(FUNCTION_SELECTORS_STORAGE_KEY, {})
    this.emitUpdate()
  }

  async #storeSelectorsInStorage() {
    const selectorsToStore: Selectors = {}
    Object.entries(this.selectors).forEach(([k, v]) => {
      if (v.status === 'loading') return
      selectorsToStore[k] = v
    })
    await this.#storage.set(FUNCTION_SELECTORS_STORAGE_KEY, selectorsToStore)
  }

  #isOld(status: Selectors[string]['status'], updatedAt: number): boolean {
    const timeSinceUpdate = Date.now() - updatedAt
    if (status === 'success' && timeSinceUpdate > SELECTOR_SUCCESS_DEADLINE_MS) return true
    if (status === 'error' && timeSinceUpdate > SELECTOR_ERROR_DEADLINE_MS) return true
    if (status === 'not-found' && timeSinceUpdate > SELECTOR_NOT_FOUND_DEADLINE_MS) return true
    return false
  }

  async #fetchBufferedSelectors() {
    await this.initialLoadPromise
    const selectorsToFetch = [...this.#debounceBufferForSelectors].filter((s) => {
      return (
        !this.selectors[s] ||
        this.selectors[s].status === 'loading' ||
        this.#isOld(this.selectors[s].status, this.selectors[s].updatedAt)
      )
    })

    this.#debounceBufferForSelectors.clear()
    if (!selectorsToFetch.length) return
    // transfer(address,uint256)
    // transfer(bytes4[9],bytes5[6],int48[11])
    // the calldata of the second one will not be decodable by the first signature
    // even though the second one is considered 'junk' by sourcify (Apr 2026)
    // we  want to be able to decode even mined function selectors
    const jointSelectors = selectorsToFetch.join(',')
    const cenaUrl = `${this.#cenaUrl}/api/v3/contracts/selectors?selectors=${jointSelectors}`
    try {
      const result:
        | { success: false; error: string }
        | { success: true; data: { [selector: string]: string[] } } = await fetchWithTimeout(
        this.#fetch,
        cenaUrl,
        {},
        3000
      ).then((r) => r.json())

      if (!result.success) {
        this.emitError({
          error: new Error('Failed to fetch contract selectors'),
          level: 'major',
          message: 'Failed to fetch contract selectors',
          sendCrashReport: true
        })
        selectorsToFetch.forEach((s) => {
          this.selectors[s] = { status: 'error', error: result.error, updatedAt: Date.now() }
        })
        this.emitUpdate()
        void this.#storeSelectorsInStorage()
        return
      }

      selectorsToFetch.forEach((selector) => {
        const signatures = result.data[selector]
        const mappedFoundSignatures = (signatures || []).map((s) => ({ signature: s }))

        if (mappedFoundSignatures.length)
          this.selectors[selector] = {
            data: mappedFoundSignatures,
            status: 'success',
            updatedAt: Date.now()
          }
        else this.selectors[selector] = { status: 'not-found', updatedAt: Date.now() }
      })
    } catch (e: any) {
      this.emitError({
        error: e,
        level: 'major',
        message: 'Failed to fetch contract selectors',
        sendCrashReport: true
      })
      selectorsToFetch.forEach((s: string) => {
        this.selectors[s] = { status: 'error', error: e.message, updatedAt: Date.now() }
      })
    }
    this.emitUpdate()
    void this.#storeSelectorsInStorage()
  }

  async getSelector(selector: string) {
    if (!this.#featureFlag.isFeatureEnabled('apiForFunctionSelectors')) {
      this.selectors[selector] = { status: 'fetching-disabled', updatedAt: Date.now() }
      this.emitUpdate()
      return
    }
    const existing = this.selectors[selector]
    if (existing) {
      if (existing.status === 'loading') return
      if (
        existing.status !== 'fetching-disabled' &&
        !this.#isOld(existing?.status, existing.updatedAt)
      )
        return
    }
    this.#debounceBufferForSelectors.add(selector)
    if (!this.#debounceSelectorFetchPromise) {
      this.#debounceSelectorFetchPromise = wait(50)
        .then(() => this.#fetchBufferedSelectors())
        .catch((e) => {
          console.error('The debounced this.#debounceSelectorFetchPromise failed', e)
        })
        .finally(() => {
          this.#debounceSelectorFetchPromise = undefined
        })
    }
    this.selectors[selector] = { status: 'loading', updatedAt: Date.now() }
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      isReady: this.isReady
    }
  }
}
