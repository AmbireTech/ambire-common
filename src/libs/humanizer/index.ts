import { ErrorRef } from '../../controllers/eventEmitter/eventEmitter'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
/* eslint-disable no-await-in-loop */
import { parse, stringify } from '../richJson/richJson'
import { humanizeCalls, humanizePlainTextMessage, humanizeTypedMessage } from './humanizerFuncs'
import {
  HumanizerCallModule,
  HumanizerFragment,
  HumanizerParsingModule,
  HumanizerPromise,
  HumanizerSettings,
  IrCall,
  IrMessage
} from './interfaces'
import { addFragsToLazyStore, lazyReadHumanizerMeta } from './lazyStorage'
import { aaveHumanizer } from './modules/Aave'
import { fallbackHumanizer } from './modules/fallBackHumanizer'
import { gasTankModule } from './modules/gasTankModule'
import { preProcessHumanizer } from './modules/preProcessModule'
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
import { HUMANIZER_META_KEY } from './utils'

// from most generic to least generic
// the final humanization is the final triggered module
export const humanizerCallModules: HumanizerCallModule[] = [
  preProcessHumanizer,
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
  emitError: (err: ErrorRef) => void,
  options?: any
) => {
  let op: AccountOp
  let message: Message | null = null
  let irCalls: IrCall[] = []
  let asyncOps: HumanizerPromise[] = []
  let parsedMessage: IrMessage
  if ('calls' in data) {
    op = parse(stringify(data))
  }
  if ('content' in data) {
    message = parse(stringify(data))
  }
  const humanizerOptions = {
    fetch,
    emitError,
    network: options?.network
  }
  for (let i = 0; i <= 3; i++) {
    // @TODO refactor conditional for nocache
    const totalHumanizerMetaToBeUsed = await lazyReadHumanizerMeta(storage, {
      nocache: options?.isExtension === false
    })
    if ('calls' in data) {
      //
      ;[irCalls, asyncOps] = humanizeCalls(
        op!,
        humanizerCallModules,
        totalHumanizerMetaToBeUsed,
        humanizerOptions
      )
      const [parsedCalls, newAsyncOps] = parseCalls(
        op!,
        irCalls,
        parsingModules,
        totalHumanizerMetaToBeUsed,
        humanizerOptions
      )
      asyncOps.push(...newAsyncOps)
      ;(callback as (response: IrCall[], nonGlobalFrags: HumanizerFragment[]) => void)(
        parsedCalls,
        op!.humanizerMetaFragments || []
      )
      //
    } else if ('content' in data) {
      const humanizerSettings: HumanizerSettings = {
        accountAddr: message!.accountAddr,
        networkId: message?.networkId || 'ethereum',
        humanizerMeta: totalHumanizerMetaToBeUsed
      }
      const irMessage: IrMessage = {
        ...message!,
        ...(message!.content.kind === 'typedMessage'
          ? humanizeTypedMessage(humanizerTMModules, message!.content)
          : humanizePlainTextMessage(message!.content))
      }

      ;[parsedMessage, asyncOps] = parseMessage(
        humanizerSettings,
        irMessage,
        parsingModules,
        humanizerOptions
      )
      ;(callback as (response: IrMessage) => void)(parsedMessage)
    }

    // if we are in the history no more than 1 cycle and no async operations
    if (options?.noAsyncOperations) return

    const humanizerFragments = await Promise.all(
      asyncOps.map((asyncOperation) => asyncOperation())
    ).then((frags) => frags.filter((x) => x) as HumanizerFragment[])
    const globalFragments = humanizerFragments.filter((f) => f.isGlobal)
    const nonGlobalFragments = humanizerFragments.filter((f) => !f.isGlobal)
    if ('calls' in data)
      // @TODO we should store the non global frags in the op
      op!.humanizerMetaFragments = [...(op!.humanizerMetaFragments || []), ...nonGlobalFragments]
    if ('content' in data)
      message!.humanizerFragments = [...(message!.humanizerFragments || []), ...nonGlobalFragments]
    await addFragsToLazyStore(storage, globalFragments, {
      urgent: options?.isExtension === false
    })

    if (!humanizerFragments.length) return
  }
}

const callsHumanizer = async (
  accountOp: AccountOp,
  storage: Storage,
  fetch: Function,
  callback: (irCalls: IrCall[], nonGlobalFrags: HumanizerFragment[]) => void,
  emitError: (err: ErrorRef) => void,
  options?: any
) => {
  await sharedHumanization(accountOp, storage, fetch, callback, emitError, options)
}

const messageHumanizer = async (
  message: Message,
  storage: Storage,
  fetch: Function,
  callback: (msgs: IrMessage) => void,
  emitError: (err: ErrorRef) => void,
  options?: any
) => {
  await sharedHumanization(message, storage, fetch, callback, emitError, options)
}

export { callsHumanizer, messageHumanizer, HUMANIZER_META_KEY }
