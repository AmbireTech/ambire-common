import { ErrorRef } from '../../controllers/eventEmitter/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { HumanizerFragment } from '../../interfaces/humanizer'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
/* eslint-disable no-await-in-loop */
import { parse, stringify } from '../richJson/richJson'
import { humanizeCalls, humanizeTypedMessage } from './humanizerFuncs'
import {
  HumanizerCallModule,
  HumanizerOptions,
  HumanizerPromise,
  IrCall,
  IrMessage
} from './interfaces'
import { addFragsToLazyStore, lazyReadHumanizerMeta } from './lazyStorage'
import OneInchModule from './modules/1Inch'
import { aaveHumanizer } from './modules/Aave'
import AcrossModule from './modules/Across'
import curveModule from './modules/Curve'
import fallbackHumanizer from './modules/FallbackHumanizer'
import gasTankModule from './modules/GasTankModule'
import KyberSwap from './modules/KyberSwap'
import { postProcessing } from './modules/PostProcessing/postProcessModule'
import preProcessHumanizer from './modules/PreProcess'
import privilegeHumanizer from './modules/Privileges'
import { SocketModule } from './modules/Socket'
import sushiSwapModule from './modules/Sushiswap'
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/Tokens'
import traderJoeModule from './modules/TraderJoe'
import { uniswapHumanizer } from './modules/Uniswap'
import { WALLETModule } from './modules/WALLET'
import wrappingModule from './modules/Wrapping'
import { erc20Module, erc721Module, permit2Module } from './typedMessageModules'
import { entryPointModule } from './typedMessageModules/entryPointModule'
import { HUMANIZER_META_KEY } from './utils'

// from most generic to least generic
// the final humanization is the final triggered module
export const humanizerCallModules: HumanizerCallModule[] = [
  preProcessHumanizer,
  genericErc721Humanizer,
  genericErc20Humanizer,
  gasTankModule,
  uniswapHumanizer,
  curveModule,
  traderJoeModule,
  KyberSwap,
  SocketModule,
  AcrossModule,
  OneInchModule,
  wrappingModule,
  aaveHumanizer,
  WALLETModule,
  privilegeHumanizer,
  sushiSwapModule,
  fallbackHumanizer,
  postProcessing
]

// from least generic to most generic
// the final visualization and warnings are from the first triggered module
const humanizerTMModules = [erc20Module, erc721Module, permit2Module, entryPointModule]

// @TODO to be removed
export const humanizeAccountOp = async (
  storage: Storage,
  accountOp: AccountOp,
  fetch: Fetch,
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
  fetch: Fetch,
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
  if ('calls' in data) {
    op = parse(stringify(data))
  }
  if ('content' in data) {
    message = parse(stringify(data))
  }
  const humanizerOptions: HumanizerOptions = {
    fetch,
    emitError,
    network: options?.network
  }
  for (let i = 0; i <= 3; i++) {
    const totalHumanizerMetaToBeUsed = await lazyReadHumanizerMeta(storage, {
      isExtension: options?.isExtension,
      nocache: options?.nocache
    })
    if ('calls' in data) {
      humanizerOptions.networkId = op!.networkId
      ;[irCalls, asyncOps] = humanizeCalls(
        op!,
        humanizerCallModules,
        totalHumanizerMetaToBeUsed,
        humanizerOptions
      )
      ;(callback as (response: IrCall[], nonGlobalFrags: HumanizerFragment[]) => void)(
        irCalls,
        op!.humanizerMetaFragments || []
      )
      //
    } else if ('content' in data && message!.content.kind === 'typedMessage') {
      const irMessage: IrMessage = {
        ...message!,
        ...humanizeTypedMessage(humanizerTMModules, message!)
      }

      ;(callback as (response: IrMessage) => void)(irMessage)
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
  fetch: Fetch,
  callback: (irCalls: IrCall[], nonGlobalFrags: HumanizerFragment[]) => void,
  emitError: (err: ErrorRef) => void,
  options?: any
) => {
  await sharedHumanization(accountOp, storage, fetch, callback, emitError, options)
}

const messageHumanizer = async (
  message: Message,
  storage: Storage,
  fetch: Fetch,
  callback: (msgs: IrMessage) => void,
  emitError: (err: ErrorRef) => void,
  options?: any
) => {
  await sharedHumanization(message, storage, fetch, callback, emitError, options)
}

export { callsHumanizer, messageHumanizer, HUMANIZER_META_KEY }
