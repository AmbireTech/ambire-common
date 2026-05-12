import { IContractInfoController, Selectors, SelectorsFromStorage } from '@/interfaces/contractInfo'
import { IEventEmitterRegistryController } from '@/interfaces/eventEmitter'
import { IFeatureFlagsController } from '@/interfaces/featureFlags'
import { Fetch } from '@/interfaces/fetch'
import { IStorageController } from '@/interfaces/storage'
import { fetchWithTimeout } from '@/utils/fetch'
import wait from '@/utils/wait'

import EventEmitter from '../eventEmitter/eventEmitter'

export const FUNCTION_SELECTORS_STORAGE_KEY = 'functionSelectors'

// The ContractInfoController is responsible for getting function selectors for contracts
export class ContractInfoController extends EventEmitter implements IContractInfoController {
  #fetch: Fetch

  #storage: IStorageController

  #debounceBufferForSelectors: Set<string> = new Set()

  #debounceSelectorFetchPromise?: Promise<() => void>

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
    const selectorsFromStorage: SelectorsFromStorage = await this.#storage.get(
      FUNCTION_SELECTORS_STORAGE_KEY,
      {}
    )
    this.selectors = Object.fromEntries(
      Object.entries(selectorsFromStorage).map(([k, data]): [string, Selectors[string]] => {
        return [k, { status: 'success', data }]
      })
    )

    // Emit update after loading to signal readiness
    this.emitUpdate()
  }

  async #storeSelectorsInStorage() {
    const selectorsToStore: SelectorsFromStorage = {}
    Object.entries(this.selectors).forEach(([k, v]) => {
      if (v.status !== 'success') return
      selectorsToStore[k] = v.data
    })
    await this.#storage.set(FUNCTION_SELECTORS_STORAGE_KEY, selectorsToStore)
  }
  async #fetchBufferedSelectors() {
    await this.initialLoadPromise
    const selectorsToFetch = [...this.#debounceBufferForSelectors].filter(
      (s) => this.selectors[s]?.status !== 'success'
    )
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
        return
      }

      Object.entries(result.data).forEach(([selector, signatures]) => {
        const mappedFoundSignatures = (signatures || [])
          .filter((s) => s)
          .map((s) => ({ signature: s }))

        if (mappedFoundSignatures.length)
          this.selectors[selector] = { data: mappedFoundSignatures, status: 'success' }
        else this.selectors[selector] = { status: 'not-found' }
      })
    } catch (e: any) {
      this.emitError({
        error: e,
        level: 'major',
        message: 'Failed to fetch contract selectors',
        sendCrashReport: true
      })
      selectorsToFetch.forEach((s: string) => {
        this.selectors[s] = { status: 'error', error: e.message }
      })
    }
    this.emitUpdate()
    void this.#storeSelectorsInStorage()
  }

  async getSelector(selector: string) {
    if (!this.#featureFlag.isFeatureEnabled('apiForFunctionSelectors')) return
    this.#debounceBufferForSelectors.add(selector)
    if (this.selectors[selector]?.status === 'success') return
    if (!this.#debounceSelectorFetchPromise) {
      wait(50)
        .then(() => this.#fetchBufferedSelectors())
        .catch((e) => {
          console.error('The debounced this.#debounceSelectorFetchPromise failed')
        })
        .finally(() => {
          this.#debounceSelectorFetchPromise = undefined
        })
    }
    this.selectors[selector] = { status: 'loading' }
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
