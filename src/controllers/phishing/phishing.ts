import jsYaml from 'js-yaml'

import { Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import { WindowManager } from '../../interfaces/window'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'

const METAMASK_BLACKLIST_URL =
  'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json'
const PHANTOM_BLACKLIST_URL =
  'https://raw.githubusercontent.com/phantom/blocklist/master/blocklist.yaml'

const STATUS_WRAPPED_METHODS = {
  getIsBlacklisted: 'INITIAL'
} as const

export class PhishingController extends EventEmitter {
  #fetch: Fetch

  #windowManager: WindowManager

  #headers: RequestInitWithCustomHeaders['headers']

  #blacklist: Set<string> = new Set() // list of blacklisted URLs

  isReady: boolean = false

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor({ fetch, windowManager }: { fetch: Fetch; windowManager: WindowManager }) {
    super()

    this.#fetch = fetch
    this.#windowManager = windowManager

    this.#headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
  }

  async #load() {
    const results = await Promise.allSettled([
      this.#fetch(METAMASK_BLACKLIST_URL, this.#headers)
        .then((res) => res.json())
        .then((data) => data.blacklist)
        .catch(() => []),
      this.#fetch(PHANTOM_BLACKLIST_URL, this.#headers)
        .then((res) => res.text())
        .then((text) => jsYaml.load(text))
        .then((data: any) => (data && data.length ? data.map((i: { url: string }) => i.url) : []))
        .catch(() => [])
    ])

    const [metamaskBlacklist, phantomBlacklist] = results.map((result) =>
      result.status === 'fulfilled' ? result.value : []
    )

    this.#blacklist = new Set([...metamaskBlacklist, ...phantomBlacklist])
    this.isReady = true

    this.emitUpdate()
  }

  async #getIsBlacklisted(url: string) {
    await this.initialLoadPromise

    try {
      const hostname = new URL(url).hostname
      if (hostname.includes('ambire') && !hostname.includes('ambire.com')) return true

      return this.#blacklist.has(hostname)
    } catch (error) {
      return false
    }
  }

  async getIsBlacklisted(url: string) {
    await this.withStatus('getIsBlacklisted', async () => this.#getIsBlacklisted(url), true)
  }

  async sendIsBlacklistedToUi(url: string) {
    await this.initialLoadPromise

    const isBlacklisted = await this.getIsBlacklisted(url)
    this.#windowManager.sendWindowUiMessage({ hostname: isBlacklisted })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
