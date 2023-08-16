/* eslint-disable no-await-in-loop */
// @TODO func that takes IrCall and returns the humanization as text
// @TODO undo eslint updates on non-related files
// @TODO use for of or for in instead of object.keys().map/.forEach
// @TODO remove '.json' from json with contract abis and selectors
// @TODO use type generics instead of any
// @TODO include new selectors and names in controller
import { Ir } from '../../libs/humanizer/interfaces'
import { Storage } from '../../interfaces/storage'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { humanize } from '../../libs/humanizer/humanizer'
import EventEmitter from '../eventEmitter'

const HUMANIZER_META_KEY = 'HumanizerMeta'

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
      const [ir, asyncOps] = humanize(accountOp, { fetch: this.#fetch })
      this.ir = ir
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

      // @TODO not store all in accountOp
      accountOp.humanizerMeta = {
        ...accountOp.humanizerMeta,
        ...storedHumanizerMeta,
        ...globalFragmentData,
        ...nonGlobalFragmentData
      }
      await this.#storage.set(HUMANIZER_META_KEY, { ...storedHumanizerMeta, ...globalFragmentData })
    }
  }
}
