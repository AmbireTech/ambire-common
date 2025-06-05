import jsYaml from 'js-yaml'

import { Fetch } from '../../interfaces/fetch'
import { WindowManager } from '../../interfaces/window'
import EventEmitter from '../eventEmitter/eventEmitter'
// eslint-disable-next-line import/no-cycle
import { StorageController } from '../storage/storage'

const METAMASK_BLACKLIST_URL =
  'https://api.github.com/repos/MetaMask/eth-phishing-detect/contents/src/config.json?ref=main'

const PHANTOM_BLACKLIST_URL =
  'https://api.github.com/repos/phantom/blocklist/contents/blocklist.yaml?ref=master'

export type StoredPhishingDetection = {
  timestamp: number
  metamaskBlacklist: string[]
  phantomBlacklist: string[]
} | null

export const domainToParts = (domain: string) => {
  try {
    return domain.split('.').reverse()
  } catch (e) {
    throw new Error(JSON.stringify(domain))
  }
}

export const matchPartsAgainstList = (source: string[], list: string[]) => {
  return list.find((domain: string) => {
    const target = domainToParts(domain)
    // target domain has more parts than source, fail
    if (target.length > source.length) return false
    // source matches target or (is deeper subdomain)
    return target.every((part, index) => source[index] === part)
  })
}

export class PhishingController extends EventEmitter {
  #fetch: Fetch

  #storage: StorageController

  #windowManager: WindowManager

  #blacklist: string[] = [] // list of blacklisted URLs

  #lastStorageUpdate: number | null = null

  updateStatus: 'LOADING' | 'INITIAL' = 'INITIAL'

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  get lastStorageUpdate() {
    return this.#lastStorageUpdate
  }

  get blacklistLength() {
    return this.#blacklist.length
  }

  constructor({
    fetch,
    storage,
    windowManager
  }: {
    fetch: Fetch
    storage: StorageController
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
    const storedPhishingDetection: StoredPhishingDetection = await this.#storage.get(
      'phishingDetection',
      null
    )

    if (storedPhishingDetection) {
      this.#blacklist = Array.from(
        new Set([
          ...storedPhishingDetection.metamaskBlacklist,
          ...storedPhishingDetection.phantomBlacklist
        ])
      )
    }
    await this.#update(storedPhishingDetection)
  }

  async #update(storedPhishingDetection: StoredPhishingDetection) {
    this.updateStatus = 'LOADING'
    this.emitUpdate()

    const headers = {
      Accept: 'application/vnd.github.v3.+json'
    } as any
    const results = await Promise.allSettled([
      this.#fetch(METAMASK_BLACKLIST_URL, headers)
        .then((res) => res.json())
        .then((metadata) => fetch(metadata.download_url))
        .then((rawRes) => rawRes.json())
        .then((data) => data.blacklist)
        .catch((e) => {
          console.error('Failed to fetch blacklist1:', e)
          return []
        }),
      this.#fetch(PHANTOM_BLACKLIST_URL, headers)
        .then((res) => res.json())
        .then((metadata) => fetch(metadata.download_url))
        .then((res) => res.text())
        .then((text) => jsYaml.load(text))
        .then((data: any) => (data && data.length ? data.map((i: { url: string }) => i.url) : []))
        .catch((e) => {
          console.error('Failed to fetch blacklist2:', e)
          return []
        })
    ])

    let [metamaskBlacklist, phantomBlacklist] = results.map((result) =>
      result.status === 'fulfilled' ? (result.value as string[]) || [] : []
    )

    if (metamaskBlacklist.length && phantomBlacklist.length) {
      const timestamp = Date.now()
      await this.#storage.set('phishingDetection', {
        timestamp,
        metamaskBlacklist: metamaskBlacklist || [],
        phantomBlacklist: phantomBlacklist || []
      })
      this.#lastStorageUpdate = timestamp
    } else if (storedPhishingDetection && !this.#lastStorageUpdate) {
      this.#lastStorageUpdate = storedPhishingDetection.timestamp
    }

    if (storedPhishingDetection) {
      metamaskBlacklist = metamaskBlacklist.length
        ? metamaskBlacklist
        : storedPhishingDetection.metamaskBlacklist
      phantomBlacklist = phantomBlacklist.length
        ? phantomBlacklist
        : storedPhishingDetection.phantomBlacklist
    }

    this.#blacklist = Array.from(new Set([...metamaskBlacklist, ...phantomBlacklist]))
    this.updateStatus = 'INITIAL'
    this.emitUpdate()
  }

  async updateIfNeeded() {
    if (this.updateStatus === 'LOADING') return
    const sixHoursInMs = 6 * 60 * 60 * 1000

    if (this.#lastStorageUpdate && Date.now() - this.#lastStorageUpdate < sixHoursInMs) return
    const storedPhishingDetection: StoredPhishingDetection = await this.#storage.get(
      'phishingDetection',
      null
    )

    if (!storedPhishingDetection) return

    if (Date.now() - storedPhishingDetection.timestamp >= sixHoursInMs) {
      await this.#update(storedPhishingDetection)
    }
  }

  async getIsBlacklisted(url: string) {
    await this.initialLoadPromise

    try {
      const hostname = new URL(url).hostname
      const domain = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname

      // blacklisted if it has `ambire` in the hostname but it is not a pre-approved ambire domain
      if (/ambire/i.test(domain) && !/\.?ambire\.com$/.test(domain)) {
        return true
      }

      const source = domainToParts(domain)
      return !!matchPartsAgainstList(source, this.#blacklist)
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
      ...super.toJSON(),
      lastStorageUpdate: this.lastStorageUpdate,
      blacklistLength: this.blacklistLength
    }
  }
}
