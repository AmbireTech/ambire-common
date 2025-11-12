/* eslint-disable no-restricted-syntax */
import { Fetch } from '../../interfaces/fetch'
import { IPhishingController } from '../../interfaces/phishing'
import { IStorageController } from '../../interfaces/storage'
import { IUiController } from '../../interfaces/ui'
import { getDappIdFromUrl } from '../../libs/dapps/helpers'
import EventEmitter from '../eventEmitter/eventEmitter'

const SCAMCHECKER_BASE_URL = 'https://cena.ambire.com/api/v3/scamchecker'

interface BlacklistedStatuses {
  [dappId: string]: {
    status: 'LOADING' | 'FAILED_TO_GET' | 'BLACKLISTED' | 'VERIFIED'
    updatedAt: number
  }
}

function filterByStatus(
  obj: {
    [item: string]: {
      status: 'LOADING' | 'FAILED_TO_GET' | 'BLACKLISTED' | 'VERIFIED'
      updatedAt: number
    }
  },
  statuses: ('LOADING' | 'FAILED_TO_GET' | 'BLACKLISTED' | 'VERIFIED')[]
) {
  return Object.entries(obj).reduce((acc: BlacklistedStatuses, [key, val]) => {
    if (statuses.includes(val.status)) acc[key] = val
    return acc
  }, {})
}

export class PhishingController extends EventEmitter implements IPhishingController {
  #fetch: Fetch

  #storage: IStorageController

  #dappsBlacklistedStatus: BlacklistedStatuses = {}

  #addressesBlacklistedStatus: BlacklistedStatuses = {}

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise?: Promise<void>

  constructor({ fetch, storage }: { fetch: Fetch; storage: IStorageController }) {
    super()

    this.#fetch = fetch
    this.#storage = storage

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#initialLoadPromise = this.#load().finally(() => {
      this.#initialLoadPromise = undefined
    })
  }

  async #load() {
    const [dappsBlacklistedStatus, addressesBlacklistedStatus] = await Promise.all([
      this.#storage.get('dappsBlacklistedStatus', {}),
      this.#storage.get('addressesBlacklistedStatus', {})
    ])

    this.#dappsBlacklistedStatus = dappsBlacklistedStatus
    this.#addressesBlacklistedStatus = addressesBlacklistedStatus

    this.emitUpdate()
  }

  /**
   * Takes a list of dapp domains and returns each with blacklist status.
   */
  async #fetchAndSetDappsBlacklistedStatus(
    urls: string[],
    callback?: (res: {
      [dappId: string]: 'LOADING' | 'FAILED_TO_GET' | 'BLACKLISTED' | 'VERIFIED'
    }) => void
  ) {
    await this.#initialLoadPromise

    if (!urls.length) return

    const dappIds = urls.map((url) => getDappIdFromUrl(url))
    const now = Date.now()
    const TWO_HOURS = 2 * 60 * 60 * 1000

    // Filter: we only fetch for ones that are missing or stale
    const idsToFetch = dappIds.filter((id) => {
      const existing = this.#dappsBlacklistedStatus[id]
      if (!existing) return true
      if (existing.status === 'LOADING') return true
      if (!existing.updatedAt || now - existing.updatedAt > TWO_HOURS) return true
      return false
    })

    // Mark only the ones we will fetch as LOADING
    idsToFetch.forEach((id) => {
      this.#dappsBlacklistedStatus[id] = {
        status: 'LOADING',
        updatedAt: this.#dappsBlacklistedStatus[id]?.updatedAt || 0
      }
    })

    !!callback &&
      callback(
        Object.fromEntries(
          dappIds.map((id) => [id, this.#dappsBlacklistedStatus[id].status])
        ) as Record<string, BlacklistedStatuses[keyof BlacklistedStatuses]['status']>
      )
    this.emitUpdate()

    // If nothing to fetch → we are done
    if (!idsToFetch.length) return

    const res = await this.#fetch(`${SCAMCHECKER_BASE_URL}/domains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: idsToFetch })
    })

    const updatedAt = Date.now()

    if (!res.ok) {
      console.error('Error: failed to fetch domains blacklisted status', res.status)
      dappIds.forEach((id) => {
        this.#dappsBlacklistedStatus[id] = { status: 'FAILED_TO_GET', updatedAt }
      })
    } else {
      const dappsBlacklistedStatus: Record<string, boolean> = await res.json()

      idsToFetch.forEach((id) => {
        this.#dappsBlacklistedStatus[id] = {
          // eslint-disable-next-line no-nested-ternary
          status: !dappsBlacklistedStatus
            ? 'FAILED_TO_GET'
            : dappsBlacklistedStatus[id]
            ? 'BLACKLISTED'
            : 'VERIFIED',
          updatedAt
        }
      })
    }

    const dappsBlacklistedStatusToStore = filterByStatus(this.#dappsBlacklistedStatus, [
      'BLACKLISTED',
      'VERIFIED'
    ])
    await this.#storage.set('dappsBlacklistedStatus', dappsBlacklistedStatusToStore)

    !!callback &&
      callback(
        Object.fromEntries(
          dappIds.map((id) => [id, this.#dappsBlacklistedStatus[id].status])
        ) as Record<string, BlacklistedStatuses[keyof BlacklistedStatuses]['status']>
      )

    this.emitUpdate()
  }

  async #fetchAndSetAddressesBlacklistedStatus(
    addresses: string[],
    callback?: (res: {
      [dappId: string]: 'LOADING' | 'FAILED_TO_GET' | 'BLACKLISTED' | 'VERIFIED'
    }) => void
  ) {
    await this.#initialLoadPromise

    if (!addresses.length) return

    const now = Date.now()
    const TWO_HOURS = 2 * 60 * 60 * 1000

    // Filter: we only fetch for ones that are missing or stale
    const addressesToFetch = addresses.filter((addr) => {
      const existing = this.#addressesBlacklistedStatus[addr]
      if (!existing) return true
      if (existing.status === 'LOADING') return true
      if (!existing.updatedAt || now - existing.updatedAt > TWO_HOURS) return true
      return false
    })

    // Mark only the ones we will fetch as LOADING
    addressesToFetch.forEach((id) => {
      this.#addressesBlacklistedStatus[id] = {
        status: 'LOADING',
        updatedAt: this.#addressesBlacklistedStatus[id]?.updatedAt || 0
      }
    })

    !!callback &&
      callback(
        Object.fromEntries(
          addresses.map((addr) => [addr, this.#addressesBlacklistedStatus[addr].status])
        ) as Record<string, BlacklistedStatuses[keyof BlacklistedStatuses]['status']>
      )
    this.emitUpdate()

    // If nothing to fetch → we are done
    if (!addressesToFetch.length) return

    const res = await this.#fetch(`${SCAMCHECKER_BASE_URL}/addresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses: addressesToFetch })
    })

    const updatedAt = Date.now()

    if (!res.ok) {
      console.error('Error: failed to fetch addresses blacklisted status', res.status)
      addressesToFetch.forEach((addr) => {
        this.#addressesBlacklistedStatus[addr] = { status: 'FAILED_TO_GET', updatedAt }
      })
    } else {
      const addressesBlacklistedStatus: Record<string, boolean> = await res.json()

      addressesToFetch.forEach((addr) => {
        this.#addressesBlacklistedStatus[addr] = {
          // eslint-disable-next-line no-nested-ternary
          status: !addressesBlacklistedStatus
            ? 'FAILED_TO_GET'
            : addressesBlacklistedStatus[addr]
            ? 'BLACKLISTED'
            : 'VERIFIED',
          updatedAt
        }
      })
    }

    const addressesBlacklistedStatusToStore = filterByStatus(this.#addressesBlacklistedStatus, [
      'BLACKLISTED',
      'VERIFIED'
    ])
    await this.#storage.set('addressesBlacklistedStatus', addressesBlacklistedStatusToStore)

    !!callback &&
      callback(
        Object.fromEntries(
          addresses.map((addr) => [addr, this.#addressesBlacklistedStatus[addr].status])
        ) as Record<string, BlacklistedStatuses[keyof BlacklistedStatuses]['status']>
      )

    this.emitUpdate()
  }

  updateDappsBlacklistedStatus(
    urls: string[],
    callback: (res: {
      [dappId: string]: 'LOADING' | 'FAILED_TO_GET' | 'BLACKLISTED' | 'VERIFIED'
    }) => void
  ) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#fetchAndSetDappsBlacklistedStatus(urls, callback)
  }

  updateAddressesBlacklistedStatus(
    urls: string[],
    callback: (res: {
      [dappId: string]: 'LOADING' | 'FAILED_TO_GET' | 'BLACKLISTED' | 'VERIFIED'
    }) => void
  ) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#fetchAndSetAddressesBlacklistedStatus(urls, callback)
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
