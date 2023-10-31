/* eslint-disable no-await-in-loop */
import { ErrorRef } from 'controllers/eventEmitter'

import { Account } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { humanizeCalls, humanizePlainTextMessage, humanizeTypedMessage } from './humanizerFuncs'
import {
  HumanizerCallModule,
  HumanizerFragment,
  HumanizerParsingModule,
  HumanizerSettings,
  IrCall,
  IrMessage
} from './interfaces'
import { aaveHumanizer } from './modules/Aave'
import { fallbackHumanizer } from './modules/fallBackHumanizer'
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/tokens'
import { uniswapHumanizer } from './modules/Uniswap'
// import { oneInchHumanizer } from '.modules/oneInch'
import { WALLETModule } from './modules/WALLET'
import { wethHumanizer } from './modules/weth'
import { yearnVaultModule } from './modules/yearnTesseractVault'
import { parseCalls, parseMessage } from './parsers'
import { nameParsing } from './parsers/nameParsing'
import { tokenParsing } from './parsers/tokenParsing'
import {
  erc20Module,
  erc721Module,
  fallbackEIP712Humanizer,
  permit2Module
} from './typedMessageModules'

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

const handleAsyncOps = async (
  asyncOps: Promise<HumanizerFragment | null>[],
  storage: Storage,
  storedHumanizerMeta: any
) => {
  let globalFragmentData = {}
  let nonGlobalFragmentData = {}
  const fragments = (await Promise.all(asyncOps)).filter((f) => f) as HumanizerFragment[]
  if (!fragments.length) [{}, {}]

  // eslint-disable-next-line @typescript-eslint/no-loop-func
  fragments.forEach((f) => {
    f.isGlobal
      ? (globalFragmentData = { ...globalFragmentData, [f.key]: f.value })
      : (nonGlobalFragmentData = { ...nonGlobalFragmentData, [f.key]: f.value })
  })

  await storage.set(HUMANIZER_META_KEY, { ...storedHumanizerMeta, ...globalFragmentData })
  return [globalFragmentData, nonGlobalFragmentData]
}

export const callsHumanizer = async (
  accountOp: AccountOp,
  knownAddresses: (Account | Key)[],
  storage: Storage,
  fetch: Function,
  callback: (irCalls: IrCall[]) => void,
  emitError: (err: ErrorRef) => void
) => {
  const op: AccountOp = {
    ...accountOp,
    humanizerMeta: {
      ...(await storage.get(HUMANIZER_META_KEY, {})),
      ...Object.fromEntries(
        knownAddresses.map((k) => {
          const key = `names:${'id' in k ? k.id : k.addr}`
          return [key, k.label]
        })
      ),
      ...accountOp.humanizerMeta
    }
  }

  for (let i = 0; i <= 3; i++) {
    const storedHumanizerMeta = await storage.get(HUMANIZER_META_KEY, {})
    const [irCalls, asyncOps] = humanizeCalls(
      { ...op, humanizerMeta: { ...op.humanizerMeta, ...storedHumanizerMeta } },
      humanizerCallModules,
      { fetch, emitError }
    )

    const [parsedCalls, newAsyncOps] = parseCalls(op, irCalls, parsingModules, { fetch, emitError })
    asyncOps.push(...newAsyncOps)
    callback(parsedCalls)

    const [globalFragmentData, nonGlobalFragmentData] = await handleAsyncOps(
      asyncOps,
      storage,
      storedHumanizerMeta
    )
    if (!Object.keys(globalFragmentData).length && !Object.keys(nonGlobalFragmentData).length)
      return
    op.humanizerMeta = {
      ...op.humanizerMeta,
      ...nonGlobalFragmentData
    }
  }
}

export const messageHumanizer = async (
  message: Message,
  knownAddresses: (Account | Key)[],
  storage: Storage,
  fetch: Function,
  callback: (msgs: IrMessage) => void,
  emitError: (err: ErrorRef) => void
) => {
  let globalFragmentData = {}
  let nonGlobalFragmentData = {}
  for (let i = 0; i < 3; i++) {
    const storedHumanizerMeta = await storage.get(HUMANIZER_META_KEY, {})
    const humanizerSettings: HumanizerSettings = {
      accountAddr: message.accountAddr,
      networkId: message?.networkId || 'ethereum',
      humanizerMeta: {
        ...(await storage.get(HUMANIZER_META_KEY, {})),
        ...Object.fromEntries(
          knownAddresses.map((k) => {
            const key = `names:${'id' in k ? k.id : k.addr}`
            return [key, k.label]
          })
        ),
        ...message.humanizerMeta,
        ...nonGlobalFragmentData
      }
    }
    const irMessage: IrMessage = {
      ...message,
      fullVisualization:
        message.content.kind === 'typedMessage'
          ? humanizeTypedMessage(humanizerTMModules, message.content)
          : humanizePlainTextMessage(message.content)
    }

    const [parsedMessage, asyncOps] = parseMessage(humanizerSettings, irMessage, parsingModules, {
      fetch,
      emitError
    })
    callback(parsedMessage)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ;[globalFragmentData, nonGlobalFragmentData] = await handleAsyncOps(
      asyncOps,
      storage,
      storedHumanizerMeta
    )
    if (!Object.keys(globalFragmentData).length && !Object.keys(nonGlobalFragmentData).length)
      return
  }
}
