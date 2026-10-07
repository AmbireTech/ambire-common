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
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
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
import { SUSPICIOUS_HOSTING_DOMAINS } from './suspiciousHostingDomains'

const SCAMCHECKER_BASE_URL = 'https://cena.ambire.com/api/v3/scamchecker'
const PHISHING_ACTIVE_VIEW_TYPES = new Set(['request-window', 'popup', 'tab'])

function isSuspiciousHostingDomain(url: string): boolean {
  // The canonical hostname, so a fully-qualified host ("my-dapp.vercel.app.") is matched against
  // the list just like the form the user believes they are on.
  const hostname = getNormalizedHostnameFromUrl(url)
  if (hostname === null) return false

  return SUSPICIOUS_HOSTING_DOMAINS.some(
    ({ hostSuffix }) => hostname === hostSuffix || hostname.endsWith(`.${hostSuffix}`)
  )
}

/**
 * Whether the user may mark the dApp at `url` as trusted, silencing the suspicious-hosting warning
 * for it. True only for a dApp on its own subdomain of a platform that hands out one per app: the
 * hostname is then a boundary the browser enforces, so the trust cannot reach anything else
 * published on the platform.
 */
export function canBeTrustedByUser(url: string): boolean {
  const hostname = getNormalizedHostnameFromUrl(url)
  if (hostname === null) return false

  // The leading dot demands a label to the left of the suffix, which is the whole point: it tells
  // one app under the platform apart from the platform's own hostname. "my-dapp.vercel.app" passes,
  // a bare "ipfs.io" does not. Note that isAppPerSubdomain alone does not cover this - a platform
  // that hands out subdomains ("<cid>.ipfs.dweb.link") usually serves by path as well, and a dApp
  // id is only the hostname, so every app on "ipfs.io/ipfs/<cid>" collapses to the same "ipfs.io".
  // Offering the trust action there would let one tap silence the warning for the whole platform.
  // Scoping the trust by path instead would not help: pages on a shared hostname are same-origin,
  // so one of them can drive a trusted one it embeds or opens.
  return SUSPICIOUS_HOSTING_DOMAINS.some(
    ({ hostSuffix, isAppPerSubdomain }) => isAppPerSubdomain && hostname.endsWith(`.${hostSuffix}`)
  )
}

type PhishingDeltaEntry = { op: 'add' | 'remove'; domain?: string; address?: string }

/**
 * Whether a phishing delta entry is an add/remove operation carrying `key` as a string. Entries
 * that are not are dropped by the relayer's own bugs, so they must never reach the local lists.
 */
function isValidDeltaEntry(entry: any, key: 'domain' | 'address'): entry is PhishingDeltaEntry {
  return !!entry && (entry.op === 'add' || entry.op === 'remove') && typeof entry[key] === 'string'
}

/**
 * Reads the `domains` and `addresses` lists out of a relayer phishing response. A missing list is
 * an empty one, but a list of the wrong type means the response is not what we asked for, and
 * applying it would either throw somewhere deeper or quietly corrupt the local lists.
 */
function getListsFromPhishingResponse(
  payload: any,
  url: string
): { domains: any[]; addresses: any[] } {
  const domains = payload?.domains ?? []
  const addresses = payload?.addresses ?? []

  if (!Array.isArray(domains) || !Array.isArray(addresses))
    throw new Error(`Phishing response does not hold domain and address lists (url: ${url})`)

  return { domains, addresses }
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

  #featureFlags: IFeatureFlagsController

  #isScamAndPhishingCheckerEnabled: boolean

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
    featureFlags,
    idb
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    fetch: Fetch
    storage: IStorageController
    addressBook: IAddressBookController
    ui: IUiController
    featureFlags: IFeatureFlagsController
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
    this.#featureFlags = featureFlags
    this.#isScamAndPhishingCheckerEnabled =
      this.#featureFlags.isFeatureEnabled('scamAndPhishingChecker')

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
      if (
        !this.#featureFlags.isFeatureEnabled('scamAndPhishingChecker') ||
        !shouldSwitchToActiveUpdateInterval
      )
        return

      // We must ensure the controller is ready for the update, otherwise there will be
      // a nasty race condition
      if (!this.isReady) {
        this.#updatePhishingInterval.updateTimeout({ timeout: PHISHING_ACTIVE_UPDATE_INTERVAL })
        return
      }

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
      if (
        !this.#featureFlags.isFeatureEnabled('scamAndPhishingChecker') ||
        !shouldSwitchToInactiveUpdateInterval
      )
        return

      if (!this.isReady) {
        this.#updatePhishingInterval.updateTimeout({ timeout: PHISHING_INACTIVE_UPDATE_INTERVAL })
        return
      }

      this.#updatePhishingInterval.restart({ timeout: PHISHING_INACTIVE_UPDATE_INTERVAL })
    })

    this.#featureFlags.onUpdate(() => {
      const isEnabled = this.#featureFlags.isFeatureEnabled('scamAndPhishingChecker')
      if (isEnabled === this.#isScamAndPhishingCheckerEnabled) return

      this.#isScamAndPhishingCheckerEnabled = isEnabled
      if (!isEnabled) {
        this.#updatePhishingInterval.stop()
        return
      }

      if (!this.isReady) return

      const hasAtLeastOneActiveViewOpen = this.#ui.views.some((view) =>
        PHISHING_ACTIVE_VIEW_TYPES.has(view.type)
      )
      this.#updatePhishingInterval.restart({
        timeout: hasAtLeastOneActiveViewOpen
          ? PHISHING_ACTIVE_UPDATE_INTERVAL
          : PHISHING_INACTIVE_UPDATE_INTERVAL,
        runImmediately: true
      })
    }, 'phishing')
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
    await this.#featureFlags.initialLoadPromise

    // The checkpoint ONLY. The background process reloads constantly, so waiting on the whole
    // list here would pay for every wake-up; lookups read one entry at a time instead.
    const meta = await this.#persistence.init()

    this.#version = meta.version
    this.#updatedAt = meta.updatedAt
    this.#hasStoredList = !!meta.version
    if (this.#featureFlags.isFeatureEnabled('scamAndPhishingChecker')) {
      this.updatePhishingInterval.start({ runImmediately: true })
    }

    this.isReady = true
    this.emitUpdate()
  }

  /**
   * Wrapper around #continuouslyUpdatePhishing that:
   * 1) deduplicates concurrent triggers via a shared promise
   * 2) switches to the failed-retry interval when the fetch/update flow throws
   */
  async continuouslyUpdatePhishing() {
    if (!this.#featureFlags.isFeatureEnabled('scamAndPhishingChecker')) return

    // The update decides between a full snapshot and a delta based on the version, so it must not
    // run before the version is read from storage. init() starts the interval once it is.
    if (!this.isReady) return

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
    const { domains, addresses } = getListsFromPhishingResponse(phishing, res.url)

    // The server speaks in deltas, so the delta is what gets written — only the entries it
    // names, rather than the whole list.
    const isIncremental = !!this.#version
    const delta: PhishingDelta = { domains: [], addresses: [] }
    let fullDomains: string[] = []
    let fullAddresses: string[] = []

    if (isIncremental) {
      // Validated before anything is written, and the version only moves forward once the whole
      // delta is in. A partly applied delta whose checkpoint had moved would drop those entries
      // for good, since no later delta repeats them.
      const invalidEntryCount =
        domains.filter((entry) => !isValidDeltaEntry(entry, 'domain')).length +
        addresses.filter((entry) => !isValidDeltaEntry(entry, 'address')).length
      if (invalidEntryCount)
        throw new Error(
          `Phishing delta holds ${invalidEntryCount} malformed entries (url: ${res.url})`
        )
      if (typeof phishing.toVersion !== 'number')
        throw new Error(`Phishing delta has no version to move to (url: ${res.url})`)

      this.#version = phishing.toVersion
      domains.forEach(({ op, domain }: PhishingDeltaEntry) => {
        delta.domains.push({ op, value: domain! })
      })
      addresses.forEach(({ op, address }: PhishingDeltaEntry) => {
        // Normalized to lowercase so a lookup matches without normalizing first, regardless
        // of the casing the relayer used.
        delta.addresses.push({ op, value: address!.toLowerCase() })
      })
    } else {
      // Initial/full update: the server sent the whole list, so it replaces what is stored.
      if (typeof phishing.version !== 'number')
        throw new Error(`Phishing snapshot has no version (url: ${res.url})`)
      if (domains.some((domain) => typeof domain !== 'string'))
        throw new Error(`Phishing snapshot holds domains that are not strings (url: ${res.url})`)
      if (addresses.some((address) => typeof address !== 'string'))
        throw new Error(`Phishing snapshot holds addresses that are not strings (url: ${res.url})`)

      this.#version = phishing.version
      fullDomains = domains
      // Normalized to lowercase so a lookup matches without normalizing first, regardless of
      // the casing the relayer used.
      fullAddresses = addresses.map((address: string) => address.toLowerCase())
    }

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

    // Only once the entries are actually stored. Setting it before the write would make the
    // lookups below read a list that is not there yet and answer VERIFIED for a domain the
    // payload flagged — and a failed write leaves it claiming a list it never got.
    this.#hasStoredList = true

    this.#shouldSyncDapps = true
    this.emitUpdate()

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
    if (!this.#featureFlags.isFeatureEnabled('scamAndPhishingChecker')) {
      if (!urls.length) return

      const statuses: { [dappId: string]: BlacklistedStatus } = {}
      urls.forEach((url) => {
        statuses[getDappIdFromUrl(url)] = 'FAILED_TO_GET'
      })
      callback(statuses)
      return
    }

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
    if (!this.#featureFlags.isFeatureEnabled('scamAndPhishingChecker')) return

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

    // Feature turned off: there is no check to run, so nothing is flagged. A settled VERIFIED,
    // not undefined — undefined means "still loading" to callers and would show a permanent
    // "couldn't check" warning for a feature the user disabled, since the list never loads.
    if (!this.#featureFlags.isFeatureEnabled('scamAndPhishingChecker')) return 'VERIFIED'

    // Cheap to wait on: #load() reads only the version checkpoint, never the entries. Without
    // it a lookup landing mid-load sees #hasStoredList still false and reports "cannot say"
    // for a domain that IS on the list — background init() is fire-and-forget, so this window
    // opens on every service-worker wake-up.
    await this.initialLoadPromise

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
    // Feature off: settled VERIFIED, not undefined — see resolveDomainBlacklistedStatus.
    if (!this.#featureFlags.isFeatureEnabled('scamAndPhishingChecker')) return 'VERIFIED'

    // See resolveDomainBlacklistedStatus — the same mid-load window applies here.
    await this.initialLoadPromise

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
