/* eslint-disable no-await-in-loop */
import {
  fallbackEIP712Humanizer,
  erc20Module,
  erc721Module,
  permit2Module
} from '../../libs/humanizer/typedMessageModules'
import {
  genericErc20Humanizer,
  genericErc721Humanizer,
  tokenParsing
} from '../../libs/humanizer/modules/tokens'
import { uniswapHumanizer } from '../../libs/humanizer/modules/Uniswap'
import { wethHumanizer } from '../../libs/humanizer/modules/weth'
import { aaveHumanizer } from '../../libs/humanizer/modules/Aave'
// import { oneInchHumanizer } from '../../libs/humanizer/modules/oneInch'
import { WALLETModule } from '../../libs/humanizer/modules/WALLET'
import { yearnVaultModule } from '../../libs/humanizer/modules/yearnTesseractVault'
import { fallbackHumanizer } from '../../libs/humanizer/modules/fallBackHumanizer'
import { nameParsing } from '../../libs/humanizer/modules/nameParsing'
import { HumanizerCallModule, Ir, IrMessage } from '../../libs/humanizer/interfaces'
import { Storage } from '../../interfaces/storage'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { humanizeCalls, humanizePLainTextMessage, humanizeTypedMessage } from '../../libs/humanizer'
import EventEmitter, { ErrorRef } from '../eventEmitter'
import { Message } from '../../interfaces/userRequest'

const HUMANIZER_META_KEY = 'HumanizerMeta'
const humanizerCallModules: HumanizerCallModule[] = [
  genericErc20Humanizer,
  genericErc721Humanizer,
  uniswapHumanizer,
  wethHumanizer,
  aaveHumanizer,
  // oneInchHumanizer,
  WALLETModule,
  yearnVaultModule,
  fallbackHumanizer,
  nameParsing,
  tokenParsing
]

const humanizerTMModules = [fallbackEIP712Humanizer, erc20Module, erc721Module, permit2Module]
export class HumanizerController extends EventEmitter {
  ir: Ir = { calls: [], messages: [] }

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

  public async humanizeCalls(_accountOp: AccountOp) {
    const accountOp: AccountOp = {
      ..._accountOp,
      humanizerMeta: {
        ..._accountOp.humanizerMeta,
        ...(await this.#storage.get(HUMANIZER_META_KEY, {}))
      }
    }

    for (let i = 0; i <= 3; i++) {
      const storedHumanizerMeta = await this.#storage.get(HUMANIZER_META_KEY, {})
      const [irCalls, asyncOps] = humanizeCalls(
        { ...accountOp, humanizerMeta: { ...accountOp.humanizerMeta, ...storedHumanizerMeta } },
        humanizerCallModules,
        { fetch: this.#fetch, emitError: this.wrappedEemitError }
      )
      this.ir.calls = irCalls
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

  public humanizeMessages(accountOp: AccountOp, messages: Message[]) {
    const irMessages: IrMessage[] = messages.map((m) => {
      let fullVisualization
      if (m.content.kind === 'typedMessage') {
        fullVisualization = humanizeTypedMessage(accountOp, humanizerTMModules, m.content)
      } else {
        fullVisualization = humanizePLainTextMessage(accountOp, m.content)
      }
      return { ...m, fullVisualization }
    })
    this.ir.messages = irMessages
    this.emitUpdate()
  }
}
