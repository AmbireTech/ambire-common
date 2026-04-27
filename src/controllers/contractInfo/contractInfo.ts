import {
  IContractInfoController,
  Selectors,
  SelectorsFromStorage,
  SourcifyFunctionsResponse
} from '@/interfaces/contractInfo'
import { IEventEmitterRegistryController } from '@/interfaces/eventEmitter'
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

  selectors: Selectors = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor({
    eventEmitterRegistry,
    fetch,
    storage
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    fetch: Fetch
    storage: IStorageController
  }) {
    super(eventEmitterRegistry)

    this.#fetch = fetch
    this.#storage = storage

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
    // we have filter=false, because on selector collisions like (0xa9059cbb)
    // transfer(address,uint256)
    // transfer(bytes4[9],bytes5[6],int48[11])
    // the calldata of the second one will not be decodable by the first signature
    // even though the second one is considered 'junk' by sourcify (Apr 2026)
    // we  want to be able to decode even mined function selectors
    const jointSelectors = selectorsToFetch.join(',')
    const sourcifyUrl = `https://api.4byte.sourcify.dev/signature-database/v1/lookup?function=${jointSelectors}&filter=false`
    try {
      const result: SourcifyFunctionsResponse = await fetchWithTimeout(
        this.#fetch,
        `${sourcifyUrl}`,
        {},
        3000
      ).then((r) => r.json())
      if (
        !result.ok ||
        !result.result ||
        !result.result.function ||
        typeof result.result.function !== 'object'
      )
        throw new Error(`Sourcify request for function selectors failed for: ${jointSelectors}`)
      Object.entries(result.result.function).forEach(([selector, dataArray]) => {
        const mappedFoundSignatures = (dataArray || [])
          .map((d) => ({ signature: d.name, filtered: d.filtered }))
          .filter((n) => n.signature)
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
