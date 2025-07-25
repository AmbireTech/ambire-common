import { Banner } from '../../interfaces/banner'
import EventEmitter from '../eventEmitter/eventEmitter'
import { StorageController } from '../storage/storage'

export class BannerController extends EventEmitter {
  #banners: Banner[] = []

  #dismissedBanners: (string | number)[] = []

  #storage: StorageController

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor(storage: StorageController) {
    super()
    this.#storage = storage

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
  }

  async #load() {
    const dismissedBanners = await this.#storage.get('dismissedBanners', [])

    this.#dismissedBanners = dismissedBanners || []
    this.emitUpdate()
  }

  get banners(): Banner[] {
    return this.#banners.filter((b) => !this.#dismissedBanners.includes(b.id)).slice()
  }

  async #saveDismissedToStorage() {
    await this.#storage.set('dismissedBanners', this.#dismissedBanners)
  }

  addBanner(banner: Banner) {
    this.#banners = [banner]
    this.emitUpdate()
  }

  async dismissBanner(bannerId: string | number) {
    const bannerExists = this.#banners.some((banner) => banner.id === bannerId)
    if (!this.#dismissedBanners.includes(bannerId) && bannerExists) {
      this.#dismissedBanners.push(bannerId)
      this.emitUpdate()
      await this.#saveDismissedToStorage()
    }
  }

  toJSON() {
    return {
      ...this,
      banners: this.banners
    }
  }
}
