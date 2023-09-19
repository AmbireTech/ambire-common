/* eslint-disable no-await-in-loop */
import { Account } from '../../interfaces/account'
import { Key } from '../../libs/keystore/keystore'
import {
  fallbackEIP712Humanizer,
  erc20Module,
  erc721Module,
  permit2Module
} from '../../libs/humanizer/typedMessageModules'
import { genericErc20Humanizer, genericErc721Humanizer } from '../../libs/humanizer/modules/tokens'
import { uniswapHumanizer } from '../../libs/humanizer/modules/Uniswap'
import { wethHumanizer } from '../../libs/humanizer/modules/weth'
import { aaveHumanizer } from '../../libs/humanizer/modules/Aave'
// import { oneInchHumanizer } from '../../libs/humanizer/modules/oneInch'
import { WALLETModule } from '../../libs/humanizer/modules/WALLET'
import { yearnVaultModule } from '../../libs/humanizer/modules/yearnTesseractVault'
import { fallbackHumanizer } from '../../libs/humanizer/modules/fallBackHumanizer'
import {
  HumanizerCallModule,
  HumanizerVisualization,
  Ir,
  IrMessage,
  HumanizerParsingModule
} from '../../libs/humanizer/interfaces'
import { Storage } from '../../interfaces/storage'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { humanizeCalls, humanizePLainTextMessage, humanizeTypedMessage } from '../../libs/humanizer'
import EventEmitter, { ErrorRef } from '../eventEmitter'
import { Message } from '../../interfaces/userRequest'
import { tokenParsing } from '../../libs/humanizer/parsers/tokenParsing'
import { nameParsing } from '../../libs/humanizer/parsers/nameParsing'
import { parseCalls, parseMessages } from '../../libs/humanizer/parsers'

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
  fallbackHumanizer
]

const parsingModules: HumanizerParsingModule[] = [nameParsing, tokenParsing]

const humanizerTMModules = [erc20Module, erc721Module, permit2Module, fallbackEIP712Humanizer]
export class HumanizerController extends EventEmitter {
  ir: Ir = { calls: [], messages: [] }

  #storage: Storage

  #fetch: Function

  constructor(storage: Storage, fetch: Function) {
    super()
    this.#storage = storage
    this.#fetch = fetch
  }

  public async humanizeCalls(_accountOp: AccountOp, _knownAddresses: (Account | Key)[] = []) {
    const knownAddresses = Object.fromEntries(
      _knownAddresses.map((k) => {
        const key = `names:${'id' in k ? k.id : k.addr}`
        return [key, k.label]
      })
    )

    const accountOp: AccountOp = {
      ..._accountOp,
      humanizerMeta: {
        ..._accountOp.humanizerMeta,
        ...(await this.#storage.get(HUMANIZER_META_KEY, {})),
        ...knownAddresses
      }
    }

    for (let i = 0; i <= 3; i++) {
      const storedHumanizerMeta = await this.#storage.get(HUMANIZER_META_KEY, {})
      const [irCalls, asyncOps] = humanizeCalls(
        { ...accountOp, humanizerMeta: { ...accountOp.humanizerMeta, ...storedHumanizerMeta } },
        humanizerCallModules,
        { fetch: this.#fetch, emitError: this.emitError.bind(this) }
      )

      const [parsedCalls, newAsyncOps] = parseCalls(accountOp, irCalls, parsingModules)
      asyncOps.push(...newAsyncOps)
      this.ir.calls = parsedCalls

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

  public async humanizeMessages(
    _accountOp: AccountOp,
    messages: Message[],
    _knownAddresses: (Account | Key)[] = []
  ) {
    const knownAddresses = Object.fromEntries(
      _knownAddresses.map((k) => {
        const key = `names:${'id' in k ? k.id : k.addr}`
        return [key, k.label]
      })
    )
    const accountOp: AccountOp = {
      ..._accountOp,
      humanizerMeta: {
        ..._accountOp.humanizerMeta,
        ...(await this.#storage.get(HUMANIZER_META_KEY, {})),
        ...knownAddresses
      }
    }
    for (let i = 0; i < 3; i++) {
      const storedHumanizerMeta = await this.#storage.get(HUMANIZER_META_KEY, {})
      const irMessages: IrMessage[] = messages.map((m) => {
        let fullVisualization: HumanizerVisualization[]
        if (m.content.kind === 'typedMessage') {
          fullVisualization = humanizeTypedMessage(accountOp, humanizerTMModules, m.content)
        } else {
          fullVisualization = humanizePLainTextMessage(accountOp, m.content)
        }
        return { ...m, fullVisualization }
      })
      let asyncOps
      ;[this.ir.messages, asyncOps] = parseMessages(accountOp, irMessages, parsingModules, {
        fetch: this.#fetch,
        emitError: this.emitError.bind(this)
      })
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
