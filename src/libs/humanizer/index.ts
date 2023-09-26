/* eslint-disable no-await-in-loop */
import { Account } from '../../interfaces/account'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { Key } from '../keystore/keystore'
import {
  humanizeCalls as humanizeCallsFunction,
  humanizePLainTextMessage,
  humanizeTypedMessage
} from './humanize'
import {
  HumanizerCallModule,
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

export const humanizeCalls = async (
  accountOp: AccountOp,
  knownAddresses: (Account | Key)[],
  storage: Storage,
  fetch: Function,
  callback: (irCalls: IrCall[]) => void
) => {
  const op: AccountOp = {
    ...accountOp,
    humanizerMeta: {
      ...accountOp.humanizerMeta,
      ...(await storage.get(HUMANIZER_META_KEY, {})),
      ...Object.fromEntries(
        knownAddresses.map((k) => {
          const key = `names:${'id' in k ? k.id : k.addr}`
          return [key, k.label]
        })
      )
    }
  }

  for (let i = 0; i <= 3; i++) {
    const storedHumanizerMeta = await storage.get(HUMANIZER_META_KEY, {})
    // @ts-ignore
    const [irCalls, asyncOps] = humanizeCallsFunction(
      { ...op, humanizerMeta: { ...op.humanizerMeta, ...storedHumanizerMeta } },
      humanizerCallModules,
      { fetch }
    )

    const [parsedCalls, newAsyncOps] = parseCalls(op, irCalls, parsingModules)
    asyncOps.push(...newAsyncOps)
    callback(parsedCalls)

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

    op.humanizerMeta = {
      ...op.humanizerMeta,
      ...nonGlobalFragmentData
    }
    await storage.set(HUMANIZER_META_KEY, { ...storedHumanizerMeta, ...globalFragmentData })
  }
}

export const humanizeMessage = async ({
  message,
  knownAddresses = [],
  storage,
  fetch,
  callback
}: {
  message: Message
  knownAddresses: (Account | Key)[]
  storage: Storage
  fetch: Function
  callback: (msgs: IrMessage) => void
}) => {
  for (let i = 0; i < 3; i++) {
    const storedHumanizerMeta = await storage.get(HUMANIZER_META_KEY, {})
    const humanizerSettings: HumanizerSettings = {
      accountAddr: message.accountAddr,
      // @TODO fic
      networkId: '1',
      humanizerMeta: {
        ...(await storage.get(HUMANIZER_META_KEY, {})),
        ...Object.fromEntries(
          knownAddresses.map((k) => {
            const key = `names:${'id' in k ? k.id : k.addr}`
            return [key, k.label]
          })
        )
      }
    }
    const irMessage: IrMessage = {
      ...message,
      fullVisualization:
        message.content.kind === 'typedMessage'
          ? humanizeTypedMessage(humanizerTMModules, message.content)
          : humanizePLainTextMessage(message.content)
    }

    const [parsedMessage, asyncOps] = parseMessage(humanizerSettings, irMessage, parsingModules, {
      fetch
    })

    callback(parsedMessage)

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

    await storage.set(HUMANIZER_META_KEY, { ...storedHumanizerMeta, ...globalFragmentData })
  }
}
