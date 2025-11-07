import { Fetch } from '../../interfaces/fetch'
import { IPhishingController } from '../../interfaces/phishing'
import { IStorageController } from '../../interfaces/storage'
import { IUiController } from '../../interfaces/ui'
import { getDappIdFromUrl } from '../../libs/dapps/helpers'
import EventEmitter from '../eventEmitter/eventEmitter'

const SCAMCHECKER_BASE_URL = 'https://cena.ambire.com/api/v3/scamchecker'

export class PhishingController extends EventEmitter implements IPhishingController {
  #fetch: Fetch

  #storage: IStorageController

  #ui: IUiController

  dappsBlacklistedStatus: {
    [dappId: string]: {
      status: 'LOADING' | 'FAILED_TO_GET' | 'BLACKLISTED' | 'NOT_BLACKLISTED'
      updatedAt: number
    }
  } = {}

  constructor({
    fetch,
    storage,
    ui
  }: {
    fetch: Fetch
    storage: IStorageController
    ui: IUiController
  }) {
    super()

    this.#fetch = fetch
    this.#storage = storage
    this.#ui = ui
  }

  /**
   * Takes a list of dapp domains and returns each with blacklist status.
   */
  async checkDappsBlacklistedStatus(urls: string[]) {
    if (!urls.length) return

    const dappIds = urls.map((url) => getDappIdFromUrl(url))
    const now = Date.now()
    const TWO_HOURS = 2 * 60 * 60 * 1000

    // Filter: we only fetch for ones that are missing or stale
    const idsToFetch = dappIds.filter((id) => {
      const existing = this.dappsBlacklistedStatus[id]
      if (!existing) return true
      if (existing.status === 'LOADING') return true
      if (!existing.updatedAt || now - existing.updatedAt > TWO_HOURS) return true
      return false
    })

    // Mark only the ones we will fetch as LOADING
    idsToFetch.forEach((id) => {
      this.dappsBlacklistedStatus[id] = {
        status: 'LOADING',
        updatedAt: this.dappsBlacklistedStatus[id]?.updatedAt || 0
      }
    })
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
      console.error('[validateDapps] phishing detection failed:', res.status)
      dappIds.forEach((id) => {
        this.dappsBlacklistedStatus[id] = { status: 'FAILED_TO_GET', updatedAt }
      })
    } else {
      const dappsBlacklistedStatus: Record<string, boolean> = await res.json()

      idsToFetch.forEach((id) => {
        this.dappsBlacklistedStatus[id] = {
          // eslint-disable-next-line no-nested-ternary
          status: !dappsBlacklistedStatus
            ? 'FAILED_TO_GET'
            : dappsBlacklistedStatus[id]
            ? 'BLACKLISTED'
            : 'NOT_BLACKLISTED',
          updatedAt
        }
      })
    }

    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
