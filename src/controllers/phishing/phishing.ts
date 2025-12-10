/* eslint-disable no-nested-ternary */
import { getDomain } from 'tldts'
/* eslint-disable no-param-reassign */
import { zeroAddress } from 'viem'

import { RecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout'
import {
  PHISHING_FAILED_TO_GET_UPDATE_INTERVAL,
  PHISHING_UPDATE_INTERVAL
} from '../../consts/intervals'
import { IAddressBookController } from '../../interfaces/addressBook'
import { Fetch } from '../../interfaces/fetch'
import { BlacklistedStatus, IPhishingController } from '../../interfaces/phishing'
import { IStorageController } from '../../interfaces/storage'
import { getDappIdFromUrl } from '../../libs/dapps/helpers'
/* eslint-disable no-restricted-syntax */
import { fetchWithTimeout } from '../../utils/fetch'
import EventEmitter from '../eventEmitter/eventEmitter'

const SCAMCHECKER_BASE_URL = 'https://cena.ambire.com/api/v3/scamchecker'

export class PhishingController extends EventEmitter implements IPhishingController {
  #fetch: Fetch

  #storage: IStorageController

  #addressBook: IAddressBookController

  #domains = new Set<string>()

  #addresses = new Set<string>()

  #version: number = 0

  #updatedAt: number | null = null

  #domainsBlacklistedStatus = new Map<string, BlacklistedStatus>()

  #addressesBlacklistedStatus = new Map<string, BlacklistedStatus>()

  #updatePhishingInterval: RecurringTimeout

  get updatePhishingInterval() {
    return this.#updatePhishingInterval
  }

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

    this.#updatePhishingInterval = new RecurringTimeout(
      async () => this.continuouslyUpdatePhishing(),
      PHISHING_UPDATE_INTERVAL,
      this.emitError.bind(this)
    )

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    const phishing = await this.#storage.get('phishing', {
      version: 0,
      updatedAt: null,
      domains: [],
      addresses: []
    })

    this.#version = phishing.version
    this.#updatedAt = phishing.updatedAt
    this.#domains = new Set(phishing.domains)
    this.#addresses = new Set(phishing.addresses)

    this.updatePhishingInterval.start({ runImmediately: true })

    this.emitUpdate()
  }

  async continuouslyUpdatePhishing() {
    await this.#continuouslyUpdatePhishing().catch(() => {
      this.updatePhishingInterval.updateTimeout({ timeout: PHISHING_FAILED_TO_GET_UPDATE_INTERVAL })
    })
  }

  async #continuouslyUpdatePhishing() {
    if (this.#updatedAt && this.#updatedAt < PHISHING_UPDATE_INTERVAL) return

    const res = await fetchWithTimeout(
      this.#fetch,
      this.#version
        ? `${SCAMCHECKER_BASE_URL}/get_update?version=${this.#version}`
        : `${SCAMCHECKER_BASE_URL}/data`,
      {},
      60000
    )

    if (!res.ok || res.status !== 200) {
      throw new Error(`Failed to update phishing (status: ${res.status}, url: ${res.url})`)
    }

    const phishing = await res.json()

    if (this.#version) {
      this.#version = phishing.toVersion || 0
      ;(phishing.domains || []).forEach(
        ({ op, domain }: { op: 'add' | 'remove'; domain: string }) => {
          if (op === 'add') this.#domains.add(domain)
          if (op === 'remove') this.#domains.delete(domain)
        }
      )
      ;(phishing.addresses || []).forEach(
        ({ op, address }: { op: 'add' | 'remove'; address: string }) => {
          if (op === 'add') this.#addresses.add(address)
          if (op === 'remove') this.#addresses.delete(address)
        }
      )
    } else {
      this.#version = phishing.version || 0
      this.#domains = new Set(phishing.domains || [])
      this.#addresses = new Set(phishing.addresses || [])
    }

    this.emitUpdate()

    await this.#storage.set('phishing', {
      version: this.#version,
      updatedAt: Date.now(),
      domains: [...this.#domains],
      addresses: [...this.#addresses]
    })

    if (this.updatePhishingInterval.currentTimeout !== PHISHING_UPDATE_INTERVAL) {
      this.updatePhishingInterval.updateTimeout({ timeout: PHISHING_UPDATE_INTERVAL })
    }
  }

  /**
   * Takes a list of dapp domains and returns each with blacklist status.
   */
  async #fetchAndSetDomainsBlacklistedStatus(
    urls: string[],
    callback?: (res: { [dappId: string]: BlacklistedStatus }) => void
  ) {
    if (!urls.length) return

    const dappsData = urls.map((url) => ({ dappId: getDappIdFromUrl(url), url }))

    if (process.env.IS_TESTING === 'true') {
      dappsData.forEach(({ dappId }) => {
        this.#domainsBlacklistedStatus.set(
          dappId,
          this.#domainsBlacklistedStatus.get(dappId) || 'VERIFIED'
        )
      })

      !!callback &&
        callback(
          Object.fromEntries(
            dappsData.map(({ dappId }) => [dappId, this.#domainsBlacklistedStatus.get(dappId)])
          ) as Record<string, BlacklistedStatus>
        )
      return
    }

    dappsData.forEach(({ dappId }) => {
      const status = this.#domains.size
        ? this.#domains.has(dappId) || this.#domains.has(getDomain(dappId)!)
          ? 'BLACKLISTED'
          : 'VERIFIED'
        : undefined
      if (status) this.#domainsBlacklistedStatus.set(dappId, status)
    })

    // Filter: we only fetch for ones that are missing or stale
    const dappsToFetch = dappsData.filter(({ dappId }) => {
      const status = this.#domainsBlacklistedStatus.get(dappId)
      if (!status) return true
      if (['FAILED_TO_GET', 'LOADING'].includes(status)) return true

      return false
    })

    // Mark only the ones we will fetch as LOADING
    dappsToFetch.forEach(({ dappId }) => {
      this.#domainsBlacklistedStatus.set(dappId, 'LOADING')
    })

    !!callback &&
      callback(
        Object.fromEntries(
          dappsData.map(({ dappId }) => [dappId, this.#domainsBlacklistedStatus.get(dappId)])
        ) as Record<string, BlacklistedStatus>
      )
    this.emitUpdate()

    if (!dappsToFetch.length) return // there will be dappsToFetch only if this.#domains is still empty

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

    if (!res.ok || res.status !== 200) {
      dappsData.forEach(({ dappId }) => {
        this.#domainsBlacklistedStatus.set(dappId, 'FAILED_TO_GET')
      })
      throw new Error(
        `Failed to fetch domains blacklisted data (status: ${res.status}, url: ${res.url})`
      )
    }

    const domainsBlacklistedStatus: Record<string, boolean> = await res.json()

    dappsToFetch.forEach(({ dappId }) => {
      this.#domainsBlacklistedStatus.set(
        dappId, // eslint-disable-next-line no-nested-ternary
        !domainsBlacklistedStatus || domainsBlacklistedStatus[dappId] === undefined
          ? 'FAILED_TO_GET'
          : domainsBlacklistedStatus[dappId]
          ? 'BLACKLISTED'
          : 'VERIFIED'
      )
    })

    !!callback &&
      callback(
        Object.fromEntries(
          dappsData.map(({ dappId }) => [dappId, this.#domainsBlacklistedStatus.get(dappId)])
        ) as Record<string, BlacklistedStatus>
      )

    this.emitUpdate()
  }

  async #fetchAndSetAddressesBlacklistedStatus(
    addresses: string[],
    callback?: (res: { [dappId: string]: BlacklistedStatus }) => void
  ) {
    await this.initialLoadPromise
    // only unique addresses
    addresses = [...new Set(addresses)]

    if (!addresses.length) return

    const addressesInAccounts = addresses.filter((addr) => {
      if (this.#addressBook.contacts.find((c) => c.isWalletAccount && c.address === addr)) {
        return true
      }

      return false
    })

    addresses.forEach((addr) => {
      const status = this.#addresses.size
        ? this.#addresses.has(addr)
          ? 'BLACKLISTED'
          : 'VERIFIED'
        : undefined
      if (status) this.#addressesBlacklistedStatus.set(addr, status)
    })

    // always return verified for the added accounts
    addressesInAccounts.forEach((addr) => {
      this.#addressesBlacklistedStatus.set(addr, 'VERIFIED')
    })

    // always return verified for the zero address
    if (addresses.includes(zeroAddress)) {
      this.#addressesBlacklistedStatus.set(zeroAddress, 'VERIFIED')
    }

    if (process.env.IS_TESTING === 'true') {
      addresses.forEach((addr) => {
        this.#addressesBlacklistedStatus.set(
          addr,
          this.#addressesBlacklistedStatus.get(addr) || 'VERIFIED'
        )
      })

      !!callback &&
        callback(
          Object.fromEntries(
            addresses.map((addr) => [addr, this.#addressesBlacklistedStatus.get(addr)])
          ) as Record<string, BlacklistedStatus>
        )
      this.emitUpdate()
      return
    }

    // Filter: we only fetch for ones that are missing or stale
    const addressesToFetch = addresses.filter((addr) => {
      const status = this.#addressesBlacklistedStatus.get(addr)
      if (!status) return true
      if (['FAILED_TO_GET', 'LOADING'].includes(status)) return true
      return false
    })

    // Mark only the ones we will fetch as LOADING
    addressesToFetch.forEach((addr) => {
      this.#addressesBlacklistedStatus.set(addr, 'LOADING')
    })

    !!callback &&
      callback(
        Object.fromEntries(
          addresses.map((addr) => [addr, this.#addressesBlacklistedStatus.get(addr)])
        ) as Record<string, BlacklistedStatus>
      )
    this.emitUpdate()

    if (!addressesToFetch.length) return // there will be addressesToFetch only if this.#addresses is still empty

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

    if (!res.ok || res.status !== 200) {
      addressesToFetch.forEach((addr) => {
        this.#addressesBlacklistedStatus.set(addr, 'FAILED_TO_GET')
      })
      throw new Error(
        `Failed to fetch addresses blacklisted data (status: ${res.status}, url: ${res.url})`
      )
    }

    const addressesBlacklistedStatus: Record<string, boolean> = await res.json()

    addressesToFetch.forEach((addr) => {
      this.#addressesBlacklistedStatus.set(
        addr,
        // eslint-disable-next-line no-nested-ternary
        !addressesBlacklistedStatus || addressesBlacklistedStatus[addr] === undefined
          ? 'FAILED_TO_GET'
          : addressesBlacklistedStatus[addr]
          ? 'BLACKLISTED'
          : 'VERIFIED'
      )
    })

    !!callback &&
      callback(
        Object.fromEntries(
          addresses.map((addr) => [addr, this.#addressesBlacklistedStatus.get(addr)])
        ) as Record<string, BlacklistedStatus>
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
      ...super.toJSON(),
      updatePhishingInterval: this.updatePhishingInterval
    }
  }
}
