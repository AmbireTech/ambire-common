import jsYaml from 'js-yaml'

import { Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import { WindowManager } from '../../interfaces/window'
import EventEmitter from '../eventEmitter/eventEmitter'

const METAMASK_BLACKLIST_URL =
  'https://api.github.com/repos/MetaMask/eth-phishing-detect/contents/src/config.json?ref=master'

const PHANTOM_BLACKLIST_URL =
  'https://api.github.com/repos/phantom/blocklist/contents/blocklist.yaml?ref=master'

export class PhishingController extends EventEmitter {
  #fetch: Fetch

  #windowManager: WindowManager

  #headers: RequestInitWithCustomHeaders['headers']

  #blacklist: Set<string> = new Set() // list of blacklisted URLs

  isReady: boolean = false

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor({ fetch, windowManager }: { fetch: Fetch; windowManager: WindowManager }) {
    super()

    this.#fetch = fetch
    this.#windowManager = windowManager

    this.#headers = {
      Accept: 'application/vnd.github.v3.+json'
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
  }

  async #load() {
    const results = await Promise.allSettled([
      this.#fetch(METAMASK_BLACKLIST_URL, this.#headers)
        .then((res) => res.json())
        .then((metadata) => fetch(metadata.download_url))
        .then((rawRes) => rawRes.json())
        .then((data) => data.blacklist)
        .catch(() => []),
      this.#fetch(PHANTOM_BLACKLIST_URL, this.#headers)
        .then((res) => res.json())
        .then((metadata) => fetch(metadata.download_url))
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

  async getIsBlacklisted(url: string) {
    this.emitUpdate()
    await this.initialLoadPromise

    try {
      const hostname = new URL(url).hostname

      // blacklisted if it has `ambire` in the hostname but it is not a pre-approved ambire domain
      if (hostname.includes('ambire') && !hostname.includes('ambire.com')) return true

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
