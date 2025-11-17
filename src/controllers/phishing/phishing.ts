import { IAddressBookController } from '../../interfaces/addressBook'
import { Fetch } from '../../interfaces/fetch'
import {
  BlacklistedStatus,
  BlacklistedStatuses,
  IPhishingController
} from '../../interfaces/phishing'
import { IStorageController } from '../../interfaces/storage'
import { getDappIdFromUrl } from '../../libs/dapps/helpers'
/* eslint-disable no-restricted-syntax */
import { fetchWithTimeout } from '../../utils/fetch'
import EventEmitter from '../eventEmitter/eventEmitter'

const SCAMCHECKER_BASE_URL = 'https://cena.ambire.com/api/v3/scamchecker'

function filterByStatus(
  obj: {
    [item: string]: { status: BlacklistedStatus; updatedAt: number }
  },
  statuses: BlacklistedStatus[]
) {
  return Object.entries(obj).reduce((acc: BlacklistedStatuses, [key, val]) => {
    if (statuses.includes(val.status)) acc[key] = val
    return acc
  }, {})
}

export class PhishingController extends EventEmitter implements IPhishingController {
  #fetch: Fetch

  #storage: IStorageController

  #addressBook: IAddressBookController

  #domainsBlacklistedStatus: BlacklistedStatuses = {}

  #addressesBlacklistedStatus: BlacklistedStatuses = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor({
    fetch,
    storage,
    addressBook
  }: {
    fetch: Fetch
    storage: IStorageController
    addressBook: IAddressBookController
  }) {
    super()

    this.#fetch = fetch
    this.#storage = storage
    this.#addressBook = addressBook

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    const [domainsBlacklistedStatus, addressesBlacklistedStatus] = await Promise.all([
      this.#storage.get('domainsBlacklistedStatus', {}),
      this.#storage.get('addressesBlacklistedStatus', {})
    ])

    const now = Date.now()
    const twoHours = 2 * 60 * 60 * 1000

    // Filter out expired records
    const freshDomainsBlacklistedStatus = Object.fromEntries(
      Object.entries(domainsBlacklistedStatus).filter(
        ([, entry]) =>
          entry && typeof entry.updatedAt === 'number' && now - entry.updatedAt < twoHours
      )
    )

    const freshAddressesBlacklistedStatus = Object.fromEntries(
      Object.entries(addressesBlacklistedStatus).filter(
        ([, entry]) =>
          entry && typeof entry.updatedAt === 'number' && now - entry.updatedAt < twoHours
      )
    )

    await this.#storage.set('domainsBlacklistedStatus', freshDomainsBlacklistedStatus)
    await this.#storage.set('addressesBlacklistedStatus', freshAddressesBlacklistedStatus)

    // this.#domainsBlacklistedStatus = freshDomainsBlacklistedStatus
    // this.#addressesBlacklistedStatus = freshAddressesBlacklistedStatus

    this.emitUpdate()
  }

  /**
   * Takes a list of dapp domains and returns each with blacklist status.
   */
  async #fetchAndSetDomainsBlacklistedStatus(
    urls: string[],
    callback?: (res: { [dappId: string]: BlacklistedStatus }) => void
  ) {
    await this.initialLoadPromise

    if (!urls.length) return

    const dappsData = urls.map((url) => ({
      dappId: getDappIdFromUrl(url),
      url
    }))
    const now = Date.now()
    const TWO_HOURS = 2 * 60 * 60 * 1000

    if (process.env.IS_TESTING === 'true') {
      dappsData.forEach(({ dappId }) => {
        this.#domainsBlacklistedStatus[dappId] = {
          status: this.#domainsBlacklistedStatus[dappId]?.status || 'VERIFIED',
          updatedAt: Date.now()
        }
      })

      !!callback &&
        callback(
          Object.fromEntries(
            dappsData.map(({ dappId }) => [dappId, this.#domainsBlacklistedStatus[dappId].status])
          ) as Record<string, BlacklistedStatuses[keyof BlacklistedStatuses]['status']>
        )
      return
    }

    // Filter: we only fetch for ones that are missing or stale
    const dappsToFetch = dappsData.filter(({ dappId }) => {
      const existing = this.#domainsBlacklistedStatus[dappId]
      if (!existing) return true
      if (existing.status === 'LOADING') return true
      if (!existing.updatedAt || now - existing.updatedAt > TWO_HOURS) return true
      return false
    })

    // Mark only the ones we will fetch as LOADING
    dappsToFetch.forEach(({ dappId }) => {
      this.#domainsBlacklistedStatus[dappId] = {
        status: 'LOADING',
        updatedAt: this.#domainsBlacklistedStatus[dappId]?.updatedAt || 0
      }
    })

    !!callback &&
      callback(
        Object.fromEntries(
          dappsData.map(({ dappId }) => [dappId, this.#domainsBlacklistedStatus[dappId].status])
        ) as Record<string, BlacklistedStatuses[keyof BlacklistedStatuses]['status']>
      )
    this.emitUpdate()

    if (!dappsToFetch.length) return

    const res = await fetchWithTimeout(
      this.#fetch,
      `${SCAMCHECKER_BASE_URL}/domains`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: dappsToFetch.map(({ dappId }) => dappId) })
      },
      dappsToFetch.length === 1 ? 5000 : 30000
    )

    const updatedAt = Date.now()
    if (!res.ok || res.status !== 200) {
      dappsData.forEach(({ dappId }) => {
        this.#domainsBlacklistedStatus[dappId] = { status: 'FAILED_TO_GET', updatedAt }
      })
      throw new Error(
        `Failed to fetch domains blacklisted data (status: ${res.status}, url: ${res.url})`
      )
    }

    const domainsBlacklistedStatus: Record<string, boolean> = await res.json()

    dappsToFetch.forEach(({ dappId }) => {
      this.#domainsBlacklistedStatus[dappId] = {
        status:
          // eslint-disable-next-line no-nested-ternary
          !domainsBlacklistedStatus || domainsBlacklistedStatus[dappId] === undefined
            ? 'FAILED_TO_GET'
            : domainsBlacklistedStatus[dappId]
            ? 'BLACKLISTED'
            : 'VERIFIED',
        updatedAt
      }
    })

    const domainsBlacklistedStatusToStore = filterByStatus(this.#domainsBlacklistedStatus, [
      'BLACKLISTED',
      'VERIFIED'
    ])
    await this.#storage.set('domainsBlacklistedStatus', domainsBlacklistedStatusToStore)

    !!callback &&
      callback(
        Object.fromEntries(
          dappsData.map(({ dappId }) => [dappId, this.#domainsBlacklistedStatus[dappId].status])
        ) as Record<string, BlacklistedStatuses[keyof BlacklistedStatuses]['status']>
      )

    this.emitUpdate()
  }

  async #fetchAndSetAddressesBlacklistedStatus(
    addresses: string[],
    callback?: (res: { [dappId: string]: BlacklistedStatus }) => void
  ) {
    await this.initialLoadPromise

    if (!addresses.length) return

    const addressesInAccounts = addresses.filter((addr) => {
      if (this.#addressBook.contacts.find((c) => c.isWalletAccount && c.address === addr)) {
        return true
      }

      return false
    })

    addressesInAccounts.forEach((addr) => {
      this.#addressesBlacklistedStatus[addr] = { status: 'VERIFIED', updatedAt: Date.now() }
    })

    if (process.env.IS_TESTING === 'true') {
      addresses.forEach((addr) => {
        this.#addressesBlacklistedStatus[addr] = {
          status: this.#addressesBlacklistedStatus[addr]?.status || 'VERIFIED',
          updatedAt: Date.now()
        }
      })

      !!callback &&
        callback(
          Object.fromEntries(
            addresses.map((addr) => [addr, this.#addressesBlacklistedStatus[addr].status])
          ) as Record<string, BlacklistedStatuses[keyof BlacklistedStatuses]['status']>
        )
      this.emitUpdate()
      return
    }

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

    const res = await fetchWithTimeout(
      this.#fetch,
      `${SCAMCHECKER_BASE_URL}/addresses`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: addressesToFetch })
      },
      5000
    )

    const updatedAt = Date.now()

    if (!res.ok || res.status !== 200) {
      addressesToFetch.forEach((addr) => {
        this.#addressesBlacklistedStatus[addr] = { status: 'FAILED_TO_GET', updatedAt }
      })
      throw new Error(
        `Failed to fetch addresses blacklisted data (status: ${res.status}, url: ${res.url})`
      )
    }

    const addressesBlacklistedStatus: Record<string, boolean> = await res.json()

    addressesToFetch.forEach((addr) => {
      this.#addressesBlacklistedStatus[addr] = {
        status:
          // eslint-disable-next-line no-nested-ternary
          !addressesBlacklistedStatus || addressesBlacklistedStatus[addr] === undefined
            ? 'FAILED_TO_GET'
            : addressesBlacklistedStatus[addr]
            ? 'BLACKLISTED'
            : 'VERIFIED',
        updatedAt
      }
    })

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

  async updateDomainsBlacklistedStatus(
    urls: string[],
    callback: (res: { [dappId: string]: BlacklistedStatus }) => void
  ) {
    try {
      await this.#fetchAndSetDomainsBlacklistedStatus(urls, callback)
    } catch (err: any) {
      this.emitError({
        message: 'Failed to fetch and update domains blacklisted status',
        error: err,
        level: 'silent'
      })
    }
  }

  async updateAddressesBlacklistedStatus(
    urls: string[],
    callback: (res: { [dappId: string]: BlacklistedStatus }) => void
  ) {
    try {
      await this.#fetchAndSetAddressesBlacklistedStatus(urls, callback)
    } catch (err: any) {
      this.emitError({
        message: 'Failed to fetch and update addresses blacklisted status',
        error: err,
        level: 'silent'
      })
    }
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
