import { IContractInfoController, Selectors } from '@/interfaces/contractInfo'
import { DecodedCall } from '@/interfaces/decodeCall'
import { IEventEmitterRegistryController } from '@/interfaces/eventEmitter'
import { IFeatureFlagsController } from '@/interfaces/featureFlags'
import { Fetch } from '@/interfaces/fetch'
import { IStorageController } from '@/interfaces/storage'
import { IUiController } from '@/interfaces/ui'
import { decodeCallDataRecursively } from '@/libs/decodeCall'
import { fetchWithTimeout } from '@/utils/fetch'
import wait from '@/utils/wait'

import EventEmitter from '../eventEmitter/eventEmitter'

export const FUNCTION_SELECTORS_STORAGE_KEY = 'functionSelectors'
export const SELECTOR_SUCCESS_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000
export const SELECTOR_NOT_FOUND_DEADLINE_MS = SELECTOR_SUCCESS_DEADLINE_MS
export const SELECTOR_ERROR_DEADLINE_MS = 5 * 60 * 1000
export const SELECTOR_FETCH_DEBOUNCE_MS = 100
export const SELECTOR_FIRST_FETCH_TIMEOUT_MS = 3 * 1000
export const SELECTOR_RETRY_FETCH_TIMEOUT_MS = 10 * 1000
/** How long a call is shown as loading while its selectors are fetched, before giving up on it. */
export const SELECTOR_LOADING_DEADLINE_MS = 5 * 1000

// The ContractInfoController is responsible for getting function selectors for contracts
export class ContractInfoController extends EventEmitter implements IContractInfoController {
  #fetch: Fetch

  #storage: IStorageController

  #featureFlag: IFeatureFlagsController

  #ui: IUiController

  #cenaUrl: string

  #selectors: Selectors = {}

  #queuedSelectors: Set<string> = new Set()

  #queuedBatchPromise?: Promise<void>

  // The batch each queued or in flight selector belongs to, so that asking for it again
  // waits on that batch instead of fetching it twice
  #selectorBatchPromises: Map<string, Promise<void>> = new Map()

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor({
    eventEmitterRegistry,
    fetch,
    storage,
    featureFlags,
    ui,
    cenaUrl = 'https://cena.ambire.com'
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    fetch: Fetch
    storage: IStorageController
    featureFlags: IFeatureFlagsController
    ui: IUiController
    cenaUrl?: string
  }) {
    super(eventEmitterRegistry)

    this.#fetch = fetch
    this.#storage = storage
    this.#featureFlag = featureFlags
    this.#ui = ui
    this.#cenaUrl = cenaUrl

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    this.#selectors = await this.#storage.get(FUNCTION_SELECTORS_STORAGE_KEY, {})
  }

  async #storeSelectorsInStorage() {
    await this.#storage.set(FUNCTION_SELECTORS_STORAGE_KEY, this.#selectors)
  }

  #isOld(status: Selectors[string]['status'], updatedAt: number): boolean {
    const timeSinceUpdate = Date.now() - updatedAt
    if (status === 'success' && timeSinceUpdate > SELECTOR_SUCCESS_DEADLINE_MS) return true
    if (status === 'error' && timeSinceUpdate > SELECTOR_ERROR_DEADLINE_MS) return true
    if (status === 'not-found' && timeSinceUpdate > SELECTOR_NOT_FOUND_DEADLINE_MS) return true
    return false
  }

  #shouldFetch(selector: string): boolean {
    if (!this.#featureFlag.isFeatureEnabled('apiForFunctionSelectors')) return false

    const savedSelector = this.#selectors[selector]

    return !savedSelector || this.#isOld(savedSelector.status, savedSelector.updatedAt)
  }

  #getSignatures(selector: string): { signature: string }[] {
    const savedSelector = this.#selectors[selector]
    if (!savedSelector || !('data' in savedSelector) || !savedSelector.data) return []

    return savedSelector.data
  }

  async #attemptToFetchAndSet(selectorsToFetch: string[], timeout: number): Promise<boolean> {
    let success = false
    try {
      // send only part of the selectors just so we do not reveal the whole thing to the backend
      // for privacy reasons
      const joinPrivateSelectors = [...new Set(selectorsToFetch.map((s) => s.slice(0, 6)))].join(
        ','
      )
      const cenaUrl = `${this.#cenaUrl}/api/v3/contracts/selectors?selectors=${joinPrivateSelectors}`

      const result:
        | { success: false; error: string }
        | { success: true; data: { [selector: string]: string[] } } = await fetchWithTimeout(
        this.#fetch,
        cenaUrl,
        {},
        timeout
      ).then((r) => r.json())
      if (!result.success) throw new Error('Failed to fetch contract selectors')
      if (
        !result.data ||
        typeof result.data !== 'object' ||
        !Object.values(result.data).every(
          (signatures) =>
            Array.isArray(signatures) && signatures.every((s) => typeof s === 'string')
        )
      )
        throw new Error('Wrong format for contract selectors')
      const deduplicatedSelectors = [...new Set([...selectorsToFetch, ...Object.keys(result.data)])]
      deduplicatedSelectors.forEach((selector) => {
        const signatures = result.data[selector]
        const mappedFoundSignatures = (signatures || []).map((s) => ({ signature: s }))

        if (mappedFoundSignatures.length)
          this.#selectors[selector] = {
            data: mappedFoundSignatures,
            status: 'success',
            updatedAt: Date.now()
          }
        else this.#selectors[selector] = { status: 'not-found', updatedAt: Date.now() }
      })
      success = true
    } catch (e: any) {
      this.emitError({
        error: e,
        level: 'silent',
        message: 'Failed to fetch contract selectors',
        sendCrashReport: true
      })
      selectorsToFetch.forEach((s: string) => {
        const oldData: { signature: string }[] | undefined =
          this.#selectors[s] && 'data' in this.#selectors[s] ? this.#selectors[s].data : undefined

        this.#selectors[s] = {
          status: 'error',
          data: oldData,
          error: e.message,
          updatedAt: Date.now()
        }
      })
    }
    void this.#storeSelectorsInStorage()
    return success
  }

  async #fetchQueuedSelectors() {
    const selectorsToFetch = [...this.#queuedSelectors]
    this.#queuedSelectors.clear()
    // Selectors asked for while this batch is in flight start the next batch
    this.#queuedBatchPromise = undefined

    try {
      const isFirstTryOk = await this.#attemptToFetchAndSet(
        selectorsToFetch,
        SELECTOR_FIRST_FETCH_TIMEOUT_MS
      )
      if (!isFirstTryOk) {
        console.error('Failed to fetch contract selectors on first try')
        await this.#attemptToFetchAndSet(selectorsToFetch, SELECTOR_RETRY_FETCH_TIMEOUT_MS)
      }
    } finally {
      selectorsToFetch.forEach((selector) => this.#selectorBatchPromises.delete(selector))
    }
  }

  #queueSelector(selector: string): Promise<void> {
    this.#queuedSelectors.add(selector)

    if (!this.#queuedBatchPromise) {
      this.#queuedBatchPromise = wait(SELECTOR_FETCH_DEBOUNCE_MS).then(() =>
        this.#fetchQueuedSelectors()
      )
    }
    this.#selectorBatchPromises.set(selector, this.#queuedBatchPromise)

    return this.#queuedBatchPromise
  }

  /**
   * Decodes call data from the saved selectors, without fetching anything. Returns the decoded
   * call, or null when it can't be decoded.
   */
  decodeCallData(data: string): DecodedCall | null {
    return decodeCallDataRecursively(data, (selector) => this.#getSignatures(selector)).decodedCall
  }

  #getMissingSelectors(datas: string[]): string[] {
    const selectors = datas.flatMap(
      (data) =>
        decodeCallDataRecursively(data, (selector) => this.#getSignatures(selector)).selectors
    )

    return [...new Set(selectors)].filter((selector) => this.#shouldFetch(selector))
  }

  /**
   * Fetches the given selectors that were never fetched or have expired. Selectors asked for
   * close together share one request, and one that is already being fetched is not asked for
   * again. Resolves once each of them is saved, found or not, and never rejects, since a failed
   * fetch is saved as an error.
   */
  async fetchSelectors(selectors: string[]): Promise<void> {
    await this.initialLoadPromise

    const batchPromises = new Set<Promise<void>>()
    selectors.forEach((selector) => {
      const pendingBatchPromise = this.#selectorBatchPromises.get(selector)
      if (pendingBatchPromise) {
        batchPromises.add(pendingBatchPromise)
        return
      }
      if (!this.#shouldFetch(selector)) return

      batchPromises.add(this.#queueSelector(selector))
    })

    await Promise.all(batchPromises)
  }

  /**
   * Fetches every selector needed to decode the given call datas, including the ones of nested
   * call data that only shows up once its parent is decoded. Selectors already being fetched are
   * waited on instead of asked for again. Resolves once each of them is saved, found or not, and
   * never rejects, since a failed fetch is saved as an error.
   */
  async fetchSelectorsForCallDatas(datas: string[]): Promise<void> {
    await this.initialLoadPromise

    // Each selector is fetched at most once per call, so the loop ends even if one isn't saved
    const attemptedSelectors = new Set<string>()
    let selectorsToFetch = this.#getMissingSelectors(datas)
    while (selectorsToFetch.length) {
      selectorsToFetch.forEach((selector) => attemptedSelectors.add(selector))
      await this.fetchSelectors(selectorsToFetch)
      selectorsToFetch = this.#getMissingSelectors(datas).filter(
        (selector) => !attemptedSelectors.has(selector)
      )
    }
  }

  /**
   * Decodes each call data from the saved selectors and replies to the UI request with the
   * decoded calls in the same order, null for the ones that can't be decoded. Nothing is fetched.
   */
  async decodeCallsForUi(datas: string[], requestId: string) {
    await this.initialLoadPromise

    const decodedCalls = datas.map((data) => this.decodeCallData(data))
    this.#ui.message.sendUiMessage({ requestId, ok: true, res: decodedCalls })
  }
}
