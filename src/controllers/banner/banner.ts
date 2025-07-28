import { Banner } from '../../interfaces/banner'
import EventEmitter from '../eventEmitter/eventEmitter'
import { StorageController } from '../storage/storage'

export class BannerController extends EventEmitter {
  #banners: Banner[] = []

  #dismissedBanners: (string | number)[] = []

  #storage: StorageController

  // Used for testing
  maxBannerCount = 1

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor(storage: StorageController) {
    super()
    this.#storage = storage

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
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

  get banners(): Banner[] {
    // Always return one banner at a time
    return this.#getValidBanners(this.#banners).slice(0, this.maxBannerCount)
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
