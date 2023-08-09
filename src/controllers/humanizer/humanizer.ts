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
  #currentIr: Ir = { calls: [] }

  #accountOp!: AccountOp

  #storage: Storage

  #fetch: Function

  #humanizerMeta: any

  #initialLoadPromise: Promise<void>

  get initialLoadPromise() {
    return this.#initialLoadPromise
  }

  get currentIr() {
    return this.#currentIr
  }

  constructor(storage: Storage, fetch: Function, humanizerMeta: any) {
    super()
    this.#storage = storage
    this.#fetch = fetch
    this.#initialLoadPromise = this.load(humanizerMeta)
  }

  private async load(humanizerMeta: any) {
    await this.#storage.set(HUMANIZER_META_KEY, humanizerMeta)
    this.#humanizerMeta = await this.#storage.get(HUMANIZER_META_KEY, {})
    this.emitUpdate()
  }

  public humanize(accountOp: AccountOp) {
    this.#accountOp = {
      ...accountOp,
      humanizerMeta: { ...accountOp.humanizerMeta, ...this.#humanizerMeta }
    }
    const [ir, asyncOps] = this.internalHumanization()
    this.#currentIr = ir
    this.emitUpdate()

    if (!asyncOps.length) return
    // @NOTE the only purpouse of thihs is cycling
    this.storeAsyncFragments(asyncOps).then(() => this.repeatHumanization())
  }

  private async repeatHumanization() {
    for (let i = 0; i <= 3; i++) {
      const [ir, newAsyncops] = this.internalHumanization()
      this.#currentIr = ir
      this.emitUpdate()
      if (!newAsyncops.length) return
      // eslint-disable-next-line no-await-in-loop
      await this.storeAsyncFragments(newAsyncops)
    }
  }

  private internalHumanization(): [Ir, Array<Promise<HumanizerFragment>>] {
    const humanizerModules = [
      genericErc20Humanizer,
      genericErc721Humanizer,
      uniswapHumanizer,
      namingHumanizer,
      fallbackHumanizer
    ]

    const options = { fetch: this.#fetch }
    let currentIr: Ir = callsToIr(this.#accountOp)
    let asyncOps: any[] = []
    humanizerModules.forEach((hm) => {
      let newPromises = []
      ;[currentIr, newPromises] = hm(this.#accountOp, currentIr, options)
      asyncOps = [...asyncOps, ...newPromises]
    })
    return [currentIr, asyncOps]
  }

  // @TODO rethik
  private async storeAsyncFragments(asyncOps: Array<Promise<HumanizerFragment>>) {
    const fragments: Array<HumanizerFragment> = await Promise.all(asyncOps)
    let globalFragmentData = {}
    let nonGlobalFragmentData = {}

    fragments.forEach((f) => {
      f.isGlobal
        ? (globalFragmentData = { ...globalFragmentData, [f.key]: f.value })
        : (nonGlobalFragmentData = { ...nonGlobalFragmentData, [f.key]: f.value })
    })

    const storedHumanizerMeta = await this.#storage.get(HUMANIZER_META_KEY, {})

    this.#accountOp = {
      ...this.#accountOp,
      humanizerMeta: { ...storedHumanizerMeta, ...globalFragmentData, ...nonGlobalFragmentData }
    }
    this.#humanizerMeta = { ...storedHumanizerMeta, ...globalFragmentData }
    await this.#storage.set(HUMANIZER_META_KEY, { ...storedHumanizerMeta, ...globalFragmentData })
  }
}
