import { getDomain } from 'tldts'

import { zeroAddress } from 'viem'

import { RecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout'
import {
  PHISHING_ACTIVE_UPDATE_INTERVAL,
  PHISHING_FAILED_TO_GET_UPDATE_INTERVAL,
  PHISHING_INACTIVE_UPDATE_INTERVAL
} from '../../consts/intervals'
import { IAddressBookController } from '../../interfaces/addressBook'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { BlacklistedStatus, IPhishingController } from '../../interfaces/phishing'
import { IStorageController } from '../../interfaces/storage'
import { IUiController } from '../../interfaces/ui'
import { getDappIdFromUrl } from '../../libs/dapps/helpers'

import { fetchWithTimeout } from '../../utils/fetch'
import EventEmitter from '../eventEmitter/eventEmitter'

const SCAMCHECKER_BASE_URL = 'https://cena.ambire.com/api/v3/scamchecker'
const PHISHING_ACTIVE_VIEW_TYPES = new Set(['request-window', 'popup', 'tab'])

/**
 * Shared hosting platforms that legitimate DeFi protocols do not use as a primary domain.
 * Phishing attacks exploit these platforms because their well-known parent domain (e.g.
 * google.com, vercel.app) makes the URL appear trustworthy and bypasses most phishing filters.
 *
 * Attack example:
 *   A user searches for "Uniswap" — a sponsored search result points to
 *   sites.google.com/uniswap, a convincing fake hosted on Google Sites.
 *   The page embeds a wallet connector that requests a signature, stealing funds.
 *
 * HOW IT WORKS
 *
 * Two independent checks feed into getDappVerificationBanner():
 *
 * 1. Intrinsic status — the dApp's own domain, resolved by getDomainBlacklistedStatus().
 *    Priority: BLACKLISTED (phishing DB) > SUSPICIOUS_HOSTING (this list) > VERIFIED.
 *
 * 2. Session context — if a dApp is loaded as an iframe inside a tab that also holds a
 *    session for a SUSPICIOUS_HOSTING or BLACKLISTED domain, #getTabContextStatus() returns
 *    SUSPICIOUS_HOSTING. This is only used for the banner — never written to #dapps or
 *    storage, so the dApp's global status is not contaminated for unrelated sessions.
 *
 * Final priority in getDappVerificationBanner():
 *   dApp intrinsic BLACKLISTED  >  context SUSPICIOUS_HOSTING  >  dApp intrinsic SUSPICIOUS_HOSTING  >  VERIFIED
 *
 * Examples:
 *   Scenario                                                                     Result
 *   sites.google.com dApp (BLACKLISTED in phishing DB)                          intrinsic=BLACKLISTED → BLACKLISTED
 *   my-dapp.vercel.app (in this list, not in phishing DB)                       intrinsic=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING (warning)
 *   ipfs.io dApp opened directly                                                intrinsic=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING (warning)
 *   app.uniswap.org iframe inside a sites.google.com tab                        intrinsic=VERIFIED, context=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING (warning)
 *   app.uniswap.org opened directly (no suspicious co-session)                  intrinsic=VERIFIED, context=undefined → VERIFIED
 *   app.uniswap.org iframe in sites.google.com, but uniswap is BLACKLISTED      intrinsic=BLACKLISTED wins → BLACKLISTED
 */
export const SUSPICIOUS_HOSTING_DOMAINS = [
// Google ecosystem
'sites.google.com',
'docs.google.com',
'drive.google.com',
'forms.google.com',
'sheets.google.com',
'slides.google.com',

// JAMstack / static hosting
'vercel.app',
'netlify.app',         
'pages.dev',            
'github.io',           

// Firebase
'firebaseapp.com',
'web.app',            

// IPFS gateway
'ipfs.io',
]

function isSuspiciousHostingDomain(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return SUSPICIOUS_HOSTING_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    )
  } catch {
    return false
  }
}

export class PhishingController extends EventEmitter implements IPhishingController {
  #fetch: Fetch

  #storage: IStorageController

  #addressBook: IAddressBookController

  #ui: IUiController

  #domains = new Set<string>()

  #addresses = new Set<string>()

  // Local versioning, used for requesting incremental phishing list updates.
  #version: number = 0

  #updatedAt: number | null = null

  #domainsBlacklistedStatus = new Map<string, BlacklistedStatus>()

  #addressesBlacklistedStatus = new Map<string, BlacklistedStatus>()

  #updatePhishingInterval: RecurringTimeout

  #shouldSyncDapps: boolean = false

  #continuouslyUpdatePhishingPromise?: Promise<void>

  get updatePhishingInterval() {
    return this.#updatePhishingInterval
  }

  get shouldSyncDapps() {
    return this.#shouldSyncDapps
  }

  resetShouldSyncDapps() {
    this.#shouldSyncDapps = false
  }

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor({
    eventEmitterRegistry,
    fetch,
    storage,
    addressBook,
    ui
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    fetch: Fetch
    storage: IStorageController
    addressBook: IAddressBookController
    ui: IUiController
  }) {
    super(eventEmitterRegistry)

    this.#fetch = fetch
    this.#storage = storage
    this.#addressBook = addressBook
    this.#ui = ui

    this.#updatePhishingInterval = new RecurringTimeout(
      async () => this.continuouslyUpdatePhishing(),
      PHISHING_INACTIVE_UPDATE_INTERVAL,
      this.emitError.bind(this)
    )

    this.#ui.uiEvent.on('addView', (view) => {
      const isActiveViewType = PHISHING_ACTIVE_VIEW_TYPES.has(view.type)
      const isAlreadyUsingActiveUpdateInterval =
        this.#updatePhishingInterval.currentTimeout === PHISHING_ACTIVE_UPDATE_INTERVAL

      const shouldSwitchToActiveUpdateInterval =
        isActiveViewType && !isAlreadyUsingActiveUpdateInterval
      if (shouldSwitchToActiveUpdateInterval)
        this.#updatePhishingInterval.restart({
          timeout: PHISHING_ACTIVE_UPDATE_INTERVAL,
          runImmediately: true
        })
    })
    this.#ui.uiEvent.on('removeView', () => {
      const hasAtLeastOneActiveViewOpen = this.#ui.views.some((view) =>
        PHISHING_ACTIVE_VIEW_TYPES.has(view.type)
      )

      const shouldSwitchToInactiveUpdateInterval = !hasAtLeastOneActiveViewOpen
      if (shouldSwitchToInactiveUpdateInterval)
        this.#updatePhishingInterval.restart({ timeout: PHISHING_INACTIVE_UPDATE_INTERVAL })
    })

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    const phishing = await this.#storage.get('phishing', {
      version: 0,
      updatedAt: 0,
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

  /**
   * Wrapper around #continuouslyUpdatePhishing that:
   * 1) deduplicates concurrent triggers via a shared promise
   * 2) switches to the failed-retry interval when the fetch/update flow throws
   */
  async continuouslyUpdatePhishing() {
    if (this.#continuouslyUpdatePhishingPromise) {
      await this.#continuouslyUpdatePhishingPromise

      return
    }

    this.#continuouslyUpdatePhishingPromise = this.#continuouslyUpdatePhishing()
      .catch((err) => {
        this.updatePhishingInterval.updateTimeout({
          timeout: PHISHING_FAILED_TO_GET_UPDATE_INTERVAL
        })
        throw err
      })
      .finally(() => {
        this.#continuouslyUpdatePhishingPromise = undefined
      })

    await this.#continuouslyUpdatePhishingPromise
  }

  async #continuouslyUpdatePhishing() {
    // This prevents redundant requests to the relayer
    // when the extension reloads multiple times within a short period.
    const timeSinceLastUpdate = this.#updatedAt ? Date.now() - this.#updatedAt : null
    if (
      this.#updatedAt &&
      timeSinceLastUpdate !== null &&
      timeSinceLastUpdate < this.updatePhishingInterval.currentTimeout
    ) {
      // NOTE: used for debugging only
      // console.log(
      //   `[PhishingController] Skip update (sinceLastUpdate=${Math.floor(timeSinceLastUpdate / 1000)}s, timeout=${Math.floor(this.updatePhishingInterval.currentTimeout / 1000)}s)`
      // )

      return
    }

    // NOTE: used for debugging only
    // console.log(
    //   `[PhishingController] Fetch update (version=${this.#version}, timeout=${Math.floor(this.updatePhishingInterval.currentTimeout / 1000)}s)`
    // )

    // version=0 means no local snapshot yet -> fetch full data.
    // version>0 means we have a checkpoint -> fetch only the delta since that version.
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
      // Incremental update: apply add/remove operations on top of local sets.
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
      // Initial/full update: replace local sets with the server snapshot.
      this.#version = phishing.version || 0
      this.#domains = new Set(phishing.domains || [])
      this.#addresses = new Set(phishing.addresses || [])
    }

    this.#shouldSyncDapps = true
    this.emitUpdate()

    const updatedAt = Date.now()
    this.#updatedAt = updatedAt

    await this.#storage.set('phishing', {
      version: this.#version,
      updatedAt,
      domains: [...this.#domains],
      addresses: [...this.#addresses]
    })

    if (this.updatePhishingInterval.currentTimeout === PHISHING_FAILED_TO_GET_UPDATE_INTERVAL) {
      this.updatePhishingInterval.updateTimeout({ timeout: PHISHING_INACTIVE_UPDATE_INTERVAL })
    }

    // NOTE: used for debugging only
    // console.log(
    //   `[PhishingController] Update applied (version=${this.#version}, domains=${this.#domains.size}, addresses=${this.#addresses.size})`
    // )
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
      dappsData.forEach(({ url, dappId }) => {
        // Suspicious hosting check runs before the VERIFIED fallback so the status is set correctly.
        if (isSuspiciousHostingDomain(url)) {
          this.#domainsBlacklistedStatus.set(dappId, 'SUSPICIOUS_HOSTING')
          return
        }
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

    // Priority: BLACKLISTED (phishing DB) > SUSPICIOUS_HOSTING > VERIFIED.
    dappsData.forEach(({ url, dappId }) => {
      if (this.#domains.size && (this.#domains.has(dappId) || this.#domains.has(getDomain(dappId)!))) {
        this.#domainsBlacklistedStatus.set(dappId, 'BLACKLISTED')
        return
      }
      if (isSuspiciousHostingDomain(url)) {
        this.#domainsBlacklistedStatus.set(dappId, 'SUSPICIOUS_HOSTING')
        return
      }
      if (this.#domains.size) this.#domainsBlacklistedStatus.set(dappId, 'VERIFIED')
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
        dappId,
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

  getDomainBlacklistedStatus(url: string): BlacklistedStatus | undefined {
    const dappId = getDappIdFromUrl(url)
    if (!dappId) return undefined

    // BLACKLISTED (phishing DB) always takes highest priority.
    if (this.#domains.size) {
      if (this.#domains.has(dappId) || this.#domains.has(getDomain(dappId)!)) return 'BLACKLISTED'
      if (isSuspiciousHostingDomain(url)) return 'SUSPICIOUS_HOSTING'
      return 'VERIFIED'
    }
    // DB not yet loaded - SUSPICIOUS_HOSTING_DOMAINS still detectable without it.
    if (isSuspiciousHostingDomain(url)) return 'SUSPICIOUS_HOSTING'
    return undefined
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      updatePhishingInterval: this.updatePhishingInterval
    }
  }
}
