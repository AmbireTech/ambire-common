import { HumanizerFragment, Ir } from 'libs/humanizer/interfaces'
import { Storage } from '../../interfaces/storage'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { genericErc20Humanizer, genericErc721Humanizer } from '../../libs/humanizer/modules/tokens'
import { uniswapHumanizer } from '../../libs/humanizer/modules/Uniswap'
import { callsToIr, fallbackHumanizer, namingHumanizer } from '../../libs/humanizer/mainHumanizer'
import EventEmitter from '../eventEmitter'

const HUMANIZER_META_KEY = 'HumanizerMeta'

// @TODO add proper error messages everywhere
export class HumanizerController extends EventEmitter {
  public currentIr: Ir = { calls: [] }

  #storage: Storage

  #humanizerMeta: any

  #fetch: Function

  #initialLoadPromise: Promise<void>

  constructor(storage: Storage, fetch: Function, humanizerMeta: any) {
    super()
    this.#storage = storage
    this.#fetch = fetch
    this.#humanizerMeta = humanizerMeta
    this.#initialLoadPromise = this.load()
  }

  private async load() {
    this.#humanizerMeta = {
      ...this.#humanizerMeta,
      ...(await this.#storage.get(HUMANIZER_META_KEY, {}))
    }
    await this.#storage.set(HUMANIZER_META_KEY, this.#humanizerMeta)
  }

  public humanize(accountOp: AccountOp) {
    const [ir, asyncOps] = this.internalHumanization(accountOp)
    this.currentIr = ir
    this.emitUpdate()

    if (!asyncOps.length) return
    // @NOTE the only purpouse of thihs is cycling
    this.storeAsyncFragments(asyncOps).then(() => this.repeatHumanization(accountOp))
  }

  private async repeatHumanization(accountOp: AccountOp) {
    for (let i = 0; i <= 3; i++) {
      const [ir, newAsyncops] = this.internalHumanization(accountOp)
      this.currentIr = ir
      this.emitUpdate()
      if (!newAsyncops.length) return
      // eslint-disable-next-line no-await-in-loop
      await this.storeAsyncFragments(newAsyncops)
    }
  }

  private internalHumanization(accOp: AccountOp): [Ir, Array<Promise<HumanizerFragment>>] {
    const humanizerModules = [
      genericErc20Humanizer,
      genericErc721Humanizer,
      uniswapHumanizer,
      namingHumanizer,
      fallbackHumanizer
    ]

    const options = { fetch: this.#fetch }
    const accountOp: AccountOp = { ...accOp, humanizerMeta: this.#humanizerMeta }
    let currentIr: Ir = callsToIr(accountOp)
    let asyncOps: any[] = []
    humanizerModules.forEach((hm) => {
      let newPromises = []
      ;[currentIr, newPromises] = hm(accountOp, currentIr, options)
      asyncOps = [...asyncOps, ...newPromises]
    })
    return [currentIr, asyncOps]
  }

  private async storeAsyncFragments(asyncOps: Array<Promise<HumanizerFragment>>) {
    if (asyncOps.length) return
    const fragments: Array<HumanizerFragment> = await Promise.all(asyncOps)
    let globalFragmentData = {}
    let nonGlobalFragmentData = {}

    fragments.forEach((f) => {
      f.isGlobal
        ? (globalFragmentData = { ...globalFragmentData, [f.key]: f.value })
        : (nonGlobalFragmentData = { ...nonGlobalFragmentData, [f.key]: f.value })
    })

    const savedHumanizerMeta = await this.#storage.get(HUMANIZER_META_KEY, {})
    this.#humanizerMeta = { ...savedHumanizerMeta, ...globalFragmentData, ...nonGlobalFragmentData }

    await this.#storage.set(HUMANIZER_META_KEY, { ...savedHumanizerMeta, ...globalFragmentData })
  }
}
