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
      address: string
      isBalanceReady: boolean
    }
export class BannerController extends EventEmitter implements IBannerController {
  #banners: Banner[] = []

  #dismissedBanners: (string | number)[] = []

  #storage: IStorageController

  #survey: ISurveyController

  #appVersion: string

  #getAccountData: () => AccountData

  // Used for testing
  maxBannerCount = 1

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor(
    storage: IStorageController,
    getAccountData: () => AccountData,
    survey: ISurveyController,
    appVersion: string,
    eventEmitterRegistry?: IEventEmitterRegistryController
  ) {
    super(eventEmitterRegistry)
    this.#storage = storage
    this.#survey = survey
    this.#getAccountData = getAccountData
    this.#appVersion = appVersion

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

  #shouldShowBanner(banner: Banner, accData: AccountData) {
    // when survey, enforce survey controller data to be loaded
    if (banner.actions?.[0]?.actionName === 'survey') {
      if (!this.#survey.isReady) return false
      if (this.#survey.isSurveyAnswered(banner.actions[0].meta.surveyId)) return false
    }

    if (accData.status === 'no-selected-account') return false

    const {
      minBalanceTotal,
      maxBalanceTotal,
      minTxnsTotal,
      maxTxnsTotal,
      minAppVersion,
      whitelistedAddresses,
      shouldHaveKeys
    } = banner.meta?.requirements || {}

    if (whitelistedAddresses && !whitelistedAddresses.includes(accData.address)) return false
    if (shouldHaveKeys && !accData.hasKeys) return false
    if (
      minBalanceTotal !== undefined &&
      (accData.totalUsdBalance < minBalanceTotal || !accData.isBalanceReady)
    )
      return false
    // if the portfolio is not fully loaded we should not assume this is the balance of the user
    // and we should not yet display the banner.
    // This isBalanceReady requirement is more important for the maxBalance than the minBalance
    if (
      maxBalanceTotal !== undefined &&
      (accData.totalUsdBalance > maxBalanceTotal || !accData.isBalanceReady)
    )
      return false
    if (minTxnsTotal !== undefined && accData.numberOfTransactions < minTxnsTotal) return false
    if (maxTxnsTotal !== undefined && accData.numberOfTransactions > maxTxnsTotal) return false
    if (minAppVersion && this.#appVersion < minAppVersion) return false

    return true
  }

  /**
   * Used when account is being switched, because we might want to display
   * different banners for different accounts.
   * The first and only (Apr 2026) such case is survey banners that have
   * to be filtered depending on balance, tx count and keys for acc
   */
  emitUpdateBanners() {
    this.emitUpdate()
  }

  get bannersData(): { banners: Banner[]; account: string | null } {
    // Always return one banner at a time
    const accData = this.#getAccountData()
    return {
      banners: this.#getValidBanners(this.#banners)
        .filter((b) => this.#shouldShowBanner(b, accData))
        .slice(0, this.maxBannerCount),
      account: accData.status === 'has-selected-account' ? accData.address : null
    }
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
      bannersData: this.bannersData
    }
  }
}
