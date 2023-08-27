/* eslint-disable no-await-in-loop */
// @TODO use for of or for in instead of object.keys().map/.forEach
// @TODO use type generics instead of any
// @TODO final review of files and jsons
import { Ir } from '../../libs/humanizer/interfaces'
import { Storage } from '../../interfaces/storage'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { humanize } from '../../libs/humanizer'
import EventEmitter from '../eventEmitter'

const HUMANIZER_META_KEY = 'HumanizerMeta'
// @TODO add 'unknown ___ action' in every module on no matcher key
// @TODO add proper error messages everywhere
export class HumanizerController extends EventEmitter {
  ir: Ir = { calls: [] }

  #storage: Storage

  #fetch: Function

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
      const storedHumanizerMeta = await this.#storage.get(HUMANIZER_META_KEY, {})
      const [ir, asyncOps] = humanize(
        { ...accountOp, humanizerMeta: { ...accountOp.humanizerMeta, ...storedHumanizerMeta } },
        { fetch: this.#fetch }
      )
      this.ir = ir
      this.emitUpdate()
      const fragments = (await Promise.all(asyncOps)).filter((f) => f)
      if (!fragments.length) return

      let globalFragmentData = {}
      let nonGlobalFragmentData = {}

      fragments.forEach((f) => {
        f.isGlobal
          ? (globalFragmentData = { ...globalFragmentData, [f.key]: f.value })
          : (nonGlobalFragmentData = { ...nonGlobalFragmentData, [f.key]: f.value })
      })

      accountOp.humanizerMeta = {
        ...accountOp.humanizerMeta,
        ...nonGlobalFragmentData
      }
      await this.#storage.set(HUMANIZER_META_KEY, { ...storedHumanizerMeta, ...globalFragmentData })
    }
  }
}
