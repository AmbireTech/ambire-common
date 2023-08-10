/* eslint-disable no-await-in-loop */
import { ethers } from 'ethers'
import { HumanizerFragment, Ir } from '../../libs/humanizer/interfaces'
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

  #storage: Storage

  #fetch: Function

  get ir() {
    return this.#currentIr
  }

  constructor(storage: Storage, fetch: Function) {
    super()
    this.#storage = storage
    this.#fetch = fetch
  }

  public async humanize(_accountOp: AccountOp) {
    const accountOp: AccountOp = {
      ..._accountOp,
      humanizerMeta: {
        ..._accountOp.humanizerMeta,
        ...(await this.#storage.get(HUMANIZER_META_KEY, {}))
      }
    }

    for (let i = 0; i <= 3; i++) {
      const [ir, asyncOps] = this.internalHumanization(accountOp)
      this.#currentIr = ir
      this.emitUpdate()
      if (!asyncOps.length) return
      const fragments = await Promise.all(asyncOps)

      let globalFragmentData = {}
      let nonGlobalFragmentData = {}

      fragments.forEach((f) => {
        f.isGlobal
          ? (globalFragmentData = { ...globalFragmentData, [f.key]: f.value })
          : (nonGlobalFragmentData = { ...nonGlobalFragmentData, [f.key]: f.value })
      })

      const storedHumanizerMeta = await this.#storage.get(HUMANIZER_META_KEY, {})
      accountOp.humanizerMeta = {
        ...accountOp.humanizerMeta,
        ...storedHumanizerMeta,
        ...globalFragmentData,
        ...nonGlobalFragmentData
      }
      await this.#storage.set(HUMANIZER_META_KEY, { ...storedHumanizerMeta, ...globalFragmentData })
    }
  }

  private internalHumanization(_accountOp: AccountOp): [Ir, Array<Promise<HumanizerFragment>>] {
    const accountOp = {
      ..._accountOp,
      calls: _accountOp.calls.map((c) => ({ ...c, to: ethers.getAddress(c.to) }))
    }
    const humanizerModules: Function[] = [
      genericErc20Humanizer,
      genericErc721Humanizer,
      uniswapHumanizer,
      namingHumanizer,
      fallbackHumanizer
    ]
    const options = { fetch: this.#fetch }
    let currentIr: Ir = callsToIr(accountOp)
    let asyncOps: any[] = []
    humanizerModules.forEach((hm) => {
      let newPromises = []
      ;[currentIr, newPromises] = hm(accountOp, currentIr, options)
      asyncOps = [...asyncOps, ...newPromises]
    })
    return [currentIr, asyncOps]
  }
}
