import { ISurveyController } from '@/interfaces/survey'

import { Banner, IBannerController } from '../../interfaces/banner'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IStorageController } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

export type AccountData =
  | {
      status: 'no-selected-account'
    }
  | {
      status: 'has-selected-account'
      numberOfTransactions: number
      totalUsdBalance: number
      hasKeys: boolean
    }
export class BannerController extends EventEmitter implements IBannerController {
  #banners: Banner[] = []

  #dismissedBanners: (string | number)[] = []

  #storage: IStorageController

  #survey: ISurveyController

  #getAccountData: () => AccountData

  // Used for testing
  maxBannerCount = 1

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor(
    storage: IStorageController,
    getAccountData: () => AccountData,
    survey: ISurveyController,
    eventEmitterRegistry?: IEventEmitterRegistryController
  ) {
    super(eventEmitterRegistry)
    this.#storage = storage
    this.#survey = survey
    this.#getAccountData = getAccountData

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  #getValidBanners(banners: Banner[]) {
    return banners.filter(({ meta, id }) => {
      if (this.#dismissedBanners.includes(id)) return false

      const endTime = meta && meta.endTime

      if (!endTime) return true

      const isExpired = Date.now() > endTime
      return !isExpired
    })
  }

  async #load() {
    const dismissedBanners = await this.#storage.get('dismissedBanners', [])

    this.#dismissedBanners = dismissedBanners || []
    this.emitUpdate()
  }

  #notSurveyOrValidSurvey(banner: Banner) {
    if (!banner.actions || !banner.actions[0]) return true
    let action = banner.actions[0]
    // if not survey return it
    if (action.actionName !== 'survey') return true
    const { minBalanceTotal, maxBalanceTotal, minTxnsTotal, maxTxnsTotal } =
      action.meta.requirements
    const accData = this.#getAccountData()
    // do not display surveys when there is no selected acc
    if (accData.status === 'no-selected-account') return false
    if (minBalanceTotal && accData.totalUsdBalance < minBalanceTotal) return false
    if (maxBalanceTotal && accData.totalUsdBalance > maxBalanceTotal) return false
    if (minTxnsTotal && accData.numberOfTransactions < minTxnsTotal) return false
    if (maxTxnsTotal && accData.numberOfTransactions > maxTxnsTotal) return false
    if (!this.#survey.isReady) return false

    if (this.#survey.isSurveyAnswered(action.meta.surveyId)) return false

    return true
  }

  get banners(): Banner[] {
    // Always return one banner at a time
    return this.#getValidBanners(this.#banners)
      .filter((b) => this.#notSurveyOrValidSurvey(b))
      .slice(0, this.maxBannerCount)
  }

  async #saveDismissedToStorage() {
    await this.#storage.set('dismissedBanners', this.#dismissedBanners)
  }

  addBanner(banner: Banner) {
    if (this.#dismissedBanners.includes(banner.id)) return

    this.#banners = this.#getValidBanners([
      ...this.#banners.filter((b) => b.id !== banner.id),
      banner
    ])

    this.emitUpdate()
  }

  async dismissBanner(bannerId: string | number) {
    const bannerExists = this.#banners.some((banner) => banner.id === bannerId)

    if (this.#dismissedBanners.includes(bannerId) || !bannerExists) return

    this.#dismissedBanners.push(bannerId)
    this.emitUpdate()
    await this.#saveDismissedToStorage()
  }

  toJSON() {
    return {
      ...this,
      banners: this.banners
    }
  }
}
