import { MarketingBanner } from '../../interfaces/banner'
import EventEmitter from '../eventEmitter/eventEmitter'
import { StorageController } from '../storage/storage'

export class BannerController extends EventEmitter {
  #banners: MarketingBanner[] = []

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
    const storedDapps = await this.#storage.get('dismissedBanners', [])

    this.#storage = storedDapps
    this.emitUpdate()
  }

  get banners(): MarketingBanner[] {
    return this.#banners
  }

  async #saveDismissedToStorage() {
    await this.#storage.set('dismissedBanners', this.#dismissedBanners)
  }

  addBanner(banner: MarketingBanner) {
    this.#banners = [banner]
    this.emitUpdate()
  }

  dismissBanner(bannerId: string | number) {
    if (!this.#dismissedBanners.includes(bannerId)) {
      this.#dismissedBanners.push(bannerId)
      this.emitUpdate()
      this.#saveDismissedToStorage()
    }
  }

  getVisibleBanners(): MarketingBanner[] {
    return this.#banners.filter((b) => !this.#dismissedBanners.includes(b.id))
  }

  toJSON() {
    return {
      ...this,
      dismissBanner: this.dismissBanner.bind(this),
      banners: this.getVisibleBanners()
    }
  }
}
