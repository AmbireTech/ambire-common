/* eslint-disable no-await-in-loop */
import { stringify, parse } from '../richJson/richJson'
import { ErrorRef } from '../../controllers/eventEmitter/eventEmitter'

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
import { gasTankModule } from './modules/gasTankModule'
import { privilegeHumanizer } from './modules/privileges'
import { sushiSwapModule } from './modules/sushiSwapModule'
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/tokens'
import { uniswapHumanizer } from './modules/Uniswap'
// import { oneInchHumanizer } from '.modules/oneInch'
import { WALLETModule } from './modules/WALLET'
import { wrappingModule } from './modules/wrapped'
import { parseCalls, parseMessage } from './parsers'
import { humanizerMetaParsing } from './parsers/humanizerMetaParsing'
import {
  erc20Module,
  erc721Module,
  fallbackEIP712Humanizer,
  permit2Module
} from './typedMessageModules'
import { addFragsToLazyStore, lazyReadHumanizerMeta } from './lazyStorage'
import { HUMANIZER_META_KEY } from './utils'
// from most generic to least generic
// the final humanization is the final triggered module
export const humanizerCallModules: HumanizerCallModule[] = [
  genericErc20Humanizer,
  genericErc721Humanizer,
  gasTankModule,
  uniswapHumanizer,
  wrappingModule,
  aaveHumanizer,
  // oneInchHumanizer,
  WALLETModule,
  privilegeHumanizer,
  sushiSwapModule,
  fallbackHumanizer
]

const parsingModules: HumanizerParsingModule[] = [humanizerMetaParsing]

// from least generic to most generic
// the final visualization and warnings are from the first triggered module
const humanizerTMModules = [erc20Module, erc721Module, permit2Module, fallbackEIP712Humanizer]

// @TODO to be removed
export const humanizeAccountOp = async (
  storage: Storage,
  accountOp: AccountOp,
  fetch: Function,
  emitError: Function
): Promise<IrCall[]> => {
  const storedHumanizerMeta = await storage.get(HUMANIZER_META_KEY, {})

  const [irCalls] = humanizeCalls(accountOp, humanizerCallModules, storedHumanizerMeta, {
    fetch,
    emitError
  })

  return irCalls
}

const sharedHumanization = async <InputDataType extends AccountOp | Message>(
  data: InputDataType,
  storage: Storage,
  fetch: Function,
  callback:
    | ((response: IrCall[], nonGlobalFrags: HumanizerFragment[]) => void)
    | ((response: IrMessage) => void),
  emitError: (err: ErrorRef) => void
) => {
  let op: AccountOp
  let irCalls: IrCall[] = []
  let asyncOps: Promise<HumanizerFragment | null>[] = []
  let parsedMessage: IrMessage
  if ('calls' in data) {
    op = parse(stringify(data))
  }
  for (let i = 0; i <= 3; i++) {
    const totalHumanizerMetaToBeUsed = await lazyReadHumanizerMeta(storage)
    if ('calls' in data) {
      //
      ;[irCalls, asyncOps] = humanizeCalls(op!, humanizerCallModules, totalHumanizerMetaToBeUsed, {
        fetch,
        emitError
      })
      const [parsedCalls, newAsyncOps] = parseCalls(
        op!,
        irCalls,
        parsingModules,
        totalHumanizerMetaToBeUsed,
        {
          fetch,
          emitError
        }
      )
      asyncOps.push(...newAsyncOps)
      ;(callback as (response: IrCall[], nonGlobalFrags: HumanizerFragment[]) => void)(
        parsedCalls,
        op!.humanizerMetaFragments || []
      )
      //
    } else if ('content' in data) {
      const humanizerSettings: HumanizerSettings = {
        accountAddr: data.accountAddr,
        networkId: data?.networkId || 'ethereum',
        humanizerMeta: totalHumanizerMetaToBeUsed
      }
      const irMessage: IrMessage = {
        ...data,
        ...(data.content.kind === 'typedMessage'
          ? humanizeTypedMessage(humanizerTMModules, data.content)
          : humanizePlainTextMessage(data.content))
      }

      ;[parsedMessage, asyncOps] = parseMessage(humanizerSettings, irMessage, parsingModules, {
        fetch,
        emitError
      })
      ;(callback as (response: IrMessage) => void)(parsedMessage)
    }

    const humanizerFragments = await Promise.all(asyncOps).then(
      (frags) => frags.filter((x) => x) as HumanizerFragment[]
    )
    const globalFragments = humanizerFragments.filter((f) => f.isGlobal)
    const nonGlobalFragments = humanizerFragments.filter((f) => !f.isGlobal)
    if ('calls' in data)
      // @TODO we should store the non global frags in the op
      op!.humanizerMetaFragments = [...(op!.humanizerMetaFragments || []), ...nonGlobalFragments]
    await addFragsToLazyStore(storage, globalFragments)
    if (!humanizerFragments.length) return
  }
}

const callsHumanizer = async (
  accountOp: AccountOp,
  storage: Storage,
  fetch: Function,
  callback: (irCalls: IrCall[], nonGlobalFrags: HumanizerFragment[]) => void,
  emitError: (err: ErrorRef) => void
) => {
  await sharedHumanization(accountOp, storage, fetch, callback, emitError)
}

const messageHumanizer = async (
  message: Message,
  storage: Storage,
  fetch: Function,
  callback: (msgs: IrMessage) => void,
  emitError: (err: ErrorRef) => void
) => {
  await sharedHumanization(message, storage, fetch, callback, emitError)
}

// those are supposed to be used by the app
// those are supposed to be used by the app
export { callsHumanizer, messageHumanizer, HUMANIZER_META_KEY }
