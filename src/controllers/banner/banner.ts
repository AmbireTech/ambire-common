import { Banner, MarketingBanner } from '../../interfaces/banner'
import EventEmitter from '../eventEmitter/eventEmitter'

export class BannerController extends EventEmitter {
  private banners: (Banner | MarketingBanner)[] = []

  addBanner(banner: Banner | MarketingBanner) {
    this.banners.push(banner)
    this.emitUpdate()
  }

  addBanners(banners: (Banner | MarketingBanner)[]) {
    this.banners.push(...banners)
    this.emitUpdate()
  }

  removeBanner(id: string | number) {
    this.banners = this.banners.filter((b) => ('id' in b ? b.id !== id : true))
    this.emitUpdate()
  }

  getBanners() {
    return this.banners
  }

  clearBanners() {
    this.banners = []
    this.emitUpdate()
  }
}
