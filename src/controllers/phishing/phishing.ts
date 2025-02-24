import jsYaml from 'js-yaml'

import { Fetch } from '../../interfaces/fetch'
import { Storage } from '../../interfaces/storage'
import { WindowManager } from '../../interfaces/window'
import EventEmitter from '../eventEmitter/eventEmitter'

const METAMASK_BLACKLIST_URL =
  'https://api.github.com/repos/MetaMask/eth-phishing-detect/contents/src/config.json?ref=master'

const PHANTOM_BLACKLIST_URL =
  'https://api.github.com/repos/phantom/blocklist/contents/blocklist.yaml?ref=master'

export class PhishingController extends EventEmitter {
  #fetch: Fetch

  #storage: Storage

  #windowManager: WindowManager

  #blacklist: Set<string> = new Set() // list of blacklisted URLs

  #latestStorageUpdate: number | null = null

  isReady: boolean = false

  updateStatus: 'LOADING' | 'INITIAL' = 'INITIAL'

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor({
    fetch,
    storage,
    windowManager
  }: {
    fetch: Fetch
    storage: Storage
    windowManager: WindowManager
  }) {
    super()

    this.#fetch = fetch
    this.#storage = storage
    this.#windowManager = windowManager

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
  }

  async #load() {
    const storedPhishingDetection = await this.#storage.get('phishingDetection', null)
    if (storedPhishingDetection) {
      this.#blacklist = new Set([
        ...storedPhishingDetection.metamaskBlacklist,
        ...storedPhishingDetection.phantomBlacklist
      ])
    }
    await this.#update(storedPhishingDetection)
    this.isReady = true

    this.emitUpdate()
  }

  async #update(
    storedPhishingDetection: {
      timestamp: number
      metamaskBlacklist: string[]
      phantomBlacklist: string[]
    } | null
  ) {
    this.updateStatus = 'LOADING'

    const headers = {
      Accept: 'application/vnd.github.v3.+json'
    } as any
    const results = await Promise.allSettled([
      this.#fetch(METAMASK_BLACKLIST_URL, headers)
        .then((res) => res.json())
        .then((metadata) => fetch(metadata.download_url))
        .then((rawRes) => rawRes.json())
        .then((data) => data.blacklist)
        .catch(() => []),
      this.#fetch(PHANTOM_BLACKLIST_URL, headers)
        .then((res) => res.json())
        .then((metadata) => fetch(metadata.download_url))
        .then((res) => res.text())
        .then((text) => jsYaml.load(text))
        .then((data: any) => (data && data.length ? data.map((i: { url: string }) => i.url) : []))
        .catch(() => [])
    ])

    let [metamaskBlacklist, phantomBlacklist] = results.map((result) =>
      result.status === 'fulfilled' ? result.value || [] : []
    )

    if (metamaskBlacklist && phantomBlacklist) {
      const timestamp = Date.now()
      await this.#storage.set('phishingDetection', {
        timestamp,
        metamaskBlacklist: metamaskBlacklist || [],
        phantomBlacklist: phantomBlacklist || []
      })
      this.#latestStorageUpdate = timestamp
    } else if (storedPhishingDetection && !this.#latestStorageUpdate) {
      this.#latestStorageUpdate = storedPhishingDetection.timestamp
    }

    if (storedPhishingDetection) {
      metamaskBlacklist = metamaskBlacklist || storedPhishingDetection.metamaskBlacklist
      phantomBlacklist = phantomBlacklist || storedPhishingDetection.phantomBlacklist
    }

    this.#blacklist = new Set([...metamaskBlacklist, ...phantomBlacklist])
    this.updateStatus = 'INITIAL'
  }

  async updateIfNeeded() {
    if (this.updateStatus === 'LOADING') return
    const sixHoursInMs = 6 * 60 * 60 * 1000

    if (this.#latestStorageUpdate && Date.now() - this.#latestStorageUpdate < sixHoursInMs) return
    const storedPhishingDetection = await this.#storage.get('phishingDetection', null)

    if (Date.now() - storedPhishingDetection.timestamp >= sixHoursInMs) {
      await this.#update(storedPhishingDetection)
    }
  }

  async getIsBlacklisted(url: string) {
    this.emitUpdate()
    await this.initialLoadPromise

    try {
      const hostname = new URL(url).hostname

      // blacklisted if it has `ambire` in the hostname but it is not a pre-approved ambire domain
      if (/ambire/i.test(hostname) && !/\.?ambire\.com$/.test(hostname)) {
        return true
      }

      return this.#blacklist.has(hostname)
    } catch (error) {
      return false
    }
  }

  async sendIsBlacklistedToUi(url: string) {
    await this.initialLoadPromise

    const isBlacklisted = await this.getIsBlacklisted(url)
    this.#windowManager.sendWindowUiMessage({
      hostname: isBlacklisted ? 'BLACKLISTED' : 'NOT_BLACKLISTED'
    })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
