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
import { getDappIdFromUrl, getNormalizedHostnameFromUrl } from '../../libs/dapps/helpers'
import { AmbireIdbDatabase } from '../../services/storage/idbDatabase'
import { PhishingDelta } from '../../services/storage/phishingIdb'
import { PhishingPersistence } from '../../services/storage/phishingPersistence'
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
 *    Both lookups are string comparisons, so they run on the canonical hostname produced by
 *    getNormalizedHostnameFromUrl()/getDappIdFromUrl() — never on a raw URL hostname, which keeps
 *    the trailing dot of a fully-qualified host and would miss every entry in both lists.
 *
 * 2. Frame context — if a dApp is loaded as an iframe inside a tab whose top-level document is
 *    on a SUSPICIOUS_HOSTING or BLACKLISTED domain, #getFrameContextStatus() returns
 *    SUSPICIOUS_HOSTING. The top-frame origin is reported by the browser with every request, so
 *    it cannot be spoofed by the page. This is only used for the banner — never written to
 *    #dapps or storage, so the dApp's global status is not contaminated for unrelated sessions.
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
 *   app.uniswap.org opened directly (it is the tab's top frame)                 intrinsic=VERIFIED, context=undefined → VERIFIED
 *   app.uniswap.org iframe in sites.google.com, but uniswap is BLACKLISTED      intrinsic=BLACKLISTED wins → BLACKLISTED
 */
/**
 * The non-Google entries below are derived from an analysis of the eth-phishing-detect
 * blocklist, ranked by how many blocked phishing
 * entries are hosted on each shared platform. Only platforms that can serve an arbitrary
 * JS wallet connector (the actual eth_requestAccounts attack vector) and that legitimate
 * DeFi protocols never use as a primary domain are included.
 *
 * Deliberately EXCLUDED despite appearing in the report, to avoid false positives on
 * legitimate traffic and because they cannot host a wallet connector:
 *   - typeform.com, zendesk.com — form/support builders; cannot run a custom connector.
 *   - medium.com — publishing platform; no custom JS.
 *   - netlify.com — Netlify's own corporate site (the user-hosting suffix netlify.app IS listed).
 *   - s3.amazonaws.com, cloudfront.net — object storage / CDN that fronts large amounts of
 *     legitimate dApp assets; low blocklist share, high false-positive risk.
 *   - translate.goog — Google Translate proxy; would flag legitimate translated browsing.
 *   - page.link — Firebase Dynamic Links (deprecated redirect service), not a host.
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
  'bitballoon.com', // Netlify legacy
  'pages.dev',
  'r2.dev', // Cloudflare R2 (public buckets serving static sites)
  'workers.dev', // Cloudflare Workers
  'github.io', // GitHub Pages
  'gitlab.io', // GitLab Pages
  'surge.sh',

  // Firebase
  'firebaseapp.com',
  'web.app',

  // Cloud app / PaaS hosts
  'azurewebsites.net',
  'onrender.com',
  'herokuapp.com',
  'railway.app',
  'glitch.me',
  'repl.co',
  'replit.app',
  'csb.app', // CodeSandbox

  // Docs hosting
  'gitbook.io',

  // Website builders
  'webflow.io',
  'mystrikingly.com',
  'b12sites.com',
  'weebly.com',
  'weeblysite.com',
  'godaddysites.com',
  'umso.co',
  'jimdosite.com',
  'tilda.ws',
  'square.site',
  'flazio.com',

  // Website / managed hosts
  'pantheonsite.io',
  'plesk.page',

  // Free web hosts
  '42web.io',
  'cprapid.com',
  '000webhostapp.com',

  // Blogging platforms
  'blogspot.com',
  'wordpress.com',

  // Dynamic DNS (abuse-prone, no legitimate DeFi usage)
  'us.to',
  'duia.us',
  'mooo.com',

  // IPFS / decentralized gateways
  'ipfs.io',
  'dweb.link',
  'cf-ipfs.com',
  'on-fleek.app',
  'fleek.co',
  'mypinata.cloud',
  '4everland.app',
  'w3s.link',
  'eth.link'
]

function isSuspiciousHostingDomain(url: string): boolean {
  // The canonical hostname, so a fully-qualified host ("my-dapp.vercel.app.") is matched against
  // the list just like the form the user believes they are on.
  const hostname = getNormalizedHostnameFromUrl(url)
  if (hostname === null) return false

  return SUSPICIOUS_HOSTING_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))
}

export class PhishingController extends EventEmitter implements IPhishingController {
  #fetch: Fetch

  #persistence: PhishingPersistence

  /**
   * Whether a list has ever been stored. Distinguishes "never fetched" from "checked and
   * absent", which the in-memory sets used to signal by being empty.
   */
  #hasStoredList = false

  #addressBook: IAddressBookController

  #ui: IUiController

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

  isReady = false

  constructor({
    eventEmitterRegistry,
    fetch,
    storage,
    addressBook,
    ui,
    idb
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    fetch: Fetch
    storage: IStorageController
    addressBook: IAddressBookController
    ui: IUiController
    /** Undefined where IndexedDB does not exist (mobile), which selects the key-value backend. */
    idb?: AmbireIdbDatabase
  }) {
    super(eventEmitterRegistry)

    this.#fetch = fetch
    this.#persistence = new PhishingPersistence({
      storage,
      idb,
      onError: ({ message, error }) => this.emitError({ level: 'silent', message, error })
    })
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
  }

  /**
   * Not called immediately on construction because the data in storage is huge and overwhelming
   * for the mobile app.
   */
  async init() {
    if (this.initialLoadPromise) return this.initialLoadPromise
    if (this.isReady) return
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
    return this.initialLoadPromise
  }

  async #load() {
    // The checkpoint ONLY. The background process reloads constantly, so waiting on the whole
    // list here would pay for every wake-up; lookups read one entry at a time instead.
    const meta = await this.#persistence.init()

    this.#version = meta.version
    this.#updatedAt = meta.updatedAt
    this.#hasStoredList = !!meta.version
    this.updatePhishingInterval.start({ runImmediately: true })

    this.isReady = true
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

    // The server speaks in deltas, so the delta is what gets written — only the entries it
    // names, rather than the whole list.
    const isIncremental = !!this.#version
    const delta: PhishingDelta = { domains: [], addresses: [] }
    let fullDomains: string[] = []
    let fullAddresses: string[] = []

    if (isIncremental) {
      this.#version = phishing.toVersion || 0
      ;(phishing.domains || []).forEach(
        ({ op, domain }: { op: 'add' | 'remove'; domain: string }) => {
          delta.domains.push({ op, value: domain })
        }
      )
      ;(phishing.addresses || []).forEach(
        ({ op, address }: { op: 'add' | 'remove'; address: string }) => {
          // Normalized to lowercase so a lookup matches without normalizing first, regardless
          // of the casing the relayer used.
          delta.addresses.push({ op, value: address.toLowerCase() })
        }
      )
    } else {
      // Initial/full update: the server sent the whole list, so it replaces what is stored.
      this.#version = phishing.version || 0
      fullDomains = phishing.domains || []
      fullAddresses = (phishing.addresses || []).map((address: string) => address.toLowerCase())
    }

    this.#hasStoredList = true

    this.#shouldSyncDapps = true
    this.emitUpdate()

    const updatedAt = Date.now()
    this.#updatedAt = updatedAt

    const meta = { version: this.#version, updatedAt }

    if (isIncremental) {
      await this.#persistence.applyDelta(delta, meta)
    } else {
      await this.#persistence.replaceAll({
        ...meta,
        domains: fullDomains,
        addresses: fullAddresses
      })
    }

    if (this.updatePhishingInterval.currentTimeout === PHISHING_FAILED_TO_GET_UPDATE_INTERVAL) {
      this.updatePhishingInterval.updateTimeout({ timeout: PHISHING_INACTIVE_UPDATE_INTERVAL })
    }

    // NOTE: used for debugging only
    // console.log(
    //   `[PhishingController] Update applied (version=${this.#version})`
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

    // Priority: BLACKLISTED > SUSPICIOUS_HOSTING > VERIFIED — all of it inside
    // resolveDomainBlacklistedStatus, which reads one entry rather than a loaded list.
    const resolved = await Promise.all(
      dappsData.map(({ url }) => this.resolveDomainBlacklistedStatus(url))
    )
    dappsData.forEach(({ dappId }, i) => {
      const status = resolved[i]
      // Undefined means "cannot say" — left unset so the network fallback below picks it up.
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

    if (!dappsToFetch.length) return // only populated when the stored list could not answer

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

    const resolvedAddresses = await Promise.all(
      addresses.map((addr) => this.resolveAddressBlacklistedStatus(addr))
    )
    addresses.forEach((addr, i) => {
      const status = resolvedAddresses[i]
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

    if (!addressesToFetch.length) return // only populated when the stored list could not answer

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

  /**
   * Resolves the blacklisted status of an address from the locally stored phishing list, without a
   * network request. Returns undefined while the list is not loaded yet, so that callers can tell
   * "not blacklisted" apart from "not checked yet".
   */
  /**
   * Whether a URL is hosted on a shared platform legitimate dApps do not use as a primary
   * domain. A constant list, so this stays synchronous and needs no storage — which is what
   * lets the frame-context banner answer without waiting on a lookup.
   */
  isSuspiciousHostingDomain(url: string): boolean {
    return isSuspiciousHostingDomain(url)
  }

  /**
   * Whether a domain is on the list, read one entry at a time instead of from an in-memory
   * set. `undefined` means "cannot say" — the list has never been fetched, or the lookup
   * failed. Never VERIFIED in either case, or a scam domain would read as safe.
   */
  async resolveDomainBlacklistedStatus(url: string): Promise<BlacklistedStatus | undefined> {
    const dappId = getDappIdFromUrl(url)
    if (!dappId) return undefined

    if (!this.#hasStoredList) {
      if (isSuspiciousHostingDomain(url)) return 'SUSPICIOUS_HOSTING'

      return undefined
    }

    const parent = getDomain(dappId)
    const [onList, parentOnList] = await Promise.all([
      this.#persistence.hasDomain(dappId),
      parent ? this.#persistence.hasDomain(parent) : Promise.resolve(false)
    ])

    if (onList === null || parentOnList === null) return undefined
    if (onList || parentOnList) return 'BLACKLISTED'
    if (isSuspiciousHostingDomain(url)) return 'SUSPICIOUS_HOSTING'

    return 'VERIFIED'
  }

  /** Whether an address is on the list. Undefined means "cannot say", never "safe". */
  async resolveAddressBlacklistedStatus(address: string): Promise<BlacklistedStatus | undefined> {
    if (!this.#hasStoredList) return undefined

    const onList = await this.#persistence.hasAddress(address)
    if (onList === null) return undefined

    return onList ? 'BLACKLISTED' : 'VERIFIED'
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      updatePhishingInterval: this.updatePhishingInterval
    }
  }
}
