/* eslint-disable no-await-in-loop */
// @TODO use type generics instead of any
// @TODO final review of files and jsons
// @TODO import produceMemoryStorage from helpers

import {
  genericErc20Humanizer,
  genericErc721Humanizer,
  tokenParsing
} from '../../libs/humanizer/modules/tokens'
import { uniswapHumanizer } from '../../libs/humanizer/modules/Uniswap'
import { wethHumanizer } from '../../libs/humanizer/modules/weth'
import { aaveHumanizer } from '../../libs/humanizer/modules/Aave'
import { oneInchHumanizer } from '../../libs/humanizer/modules/oneInch'
import { WALLETModule } from '../../libs/humanizer/modules/WALLET'
import { yearnVaultModule } from '../../libs/humanizer/modules/yearnTesseractVault'
import { fallbackHumanizer } from '../../libs/humanizer/modules/fallBackHumanizer'
import { nameParsing } from '../../libs/humanizer/modules/nameParsing'
import { Ir } from '../../libs/humanizer/interfaces'
import { Storage } from '../../interfaces/storage'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { humanize } from '../../libs/humanizer'
import EventEmitter, { ErrorRef } from '../eventEmitter'

const HUMANIZER_META_KEY = 'HumanizerMeta'
const humanizerModules: Function[] = [
  genericErc20Humanizer,
  genericErc721Humanizer,
  uniswapHumanizer,
  wethHumanizer,
  aaveHumanizer,
  oneInchHumanizer,
  WALLETModule,
  yearnVaultModule,
  fallbackHumanizer,
  nameParsing,
  tokenParsing
]
export class HumanizerController extends EventEmitter {
  ir: Ir = { calls: [] }

  #storage: Storage

  #fetch: Function

  constructor(storage: Storage, fetch: Function) {
    super()
    this.#storage = storage
    this.#fetch = fetch
  }

  public wrappedEemitError(e: ErrorRef) {
    this.emitError(e)
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
        humanizerModules,
        { fetch: this.#fetch, emitError: this.wrappedEemitError }
      )
      this.ir = ir
      this.emitUpdate()
      const fragments = (await Promise.all(asyncOps)).filter((f) => f)
      if (!fragments.length) return

      let globalFragmentData = {}
      let nonGlobalFragmentData = {}

      fragments.forEach((f) => {
        if (f)
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
