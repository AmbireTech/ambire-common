import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { ErrorRef } from '../../controllers/eventEmitter/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { parse, stringify } from '../richJson/richJson'
import { humanizeCalls, humanizeTypedMessage } from './humanizerFuncs'
import {
  HumanizerCallModule,
  HumanizerMeta,
  HumanizerOptions,
  IrCall,
  IrMessage
} from './interfaces'
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
  const irCalls = humanizeCalls(accountOp, humanizerCallModules, humanizerInfo as HumanizerMeta, {
    fetch,
    emitError
  })

  return irCalls
}

const sharedHumanization = async <InputDataType extends AccountOp | Message>(
  data: InputDataType,
  fetch: Fetch,
  callback:
    | ((response: IrCall[]) => void)
    | ((response: IrMessage) => void),
  emitError: (err: ErrorRef) => void,
  options?: any
) => {
  let op: AccountOp
  let message: Message | null = null
  let irCalls: IrCall[] = []
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

  if ('calls' in data) {
    humanizerOptions.networkId = op!.networkId
    irCalls = humanizeCalls(
      op!,
      humanizerCallModules,
      humanizerInfo as HumanizerMeta,
      humanizerOptions
    )
    ;(callback as (response: IrCall[]) => void)(
      irCalls
    )
  } else if ('content' in data && message!.content.kind === 'typedMessage') {
    const irMessage: IrMessage = {
      ...message!,
      ...humanizeTypedMessage(humanizerTMModules, message!)
    }

    ;(callback as (response: IrMessage) => void)(irMessage)
  }
}

const callsHumanizer = async (
  accountOp: AccountOp,
  fetch: Fetch,
  callback: (irCalls: IrCall[]) => void,
  emitError: (err: ErrorRef) => void,
  options?: any
) => {
  await sharedHumanization(accountOp,  fetch, callback, emitError, options)
}

const messageHumanizer = async (
  message: Message,
  fetch: Fetch,
  callback: (msgs: IrMessage) => void,
  emitError: (err: ErrorRef) => void,
  options?: any
) => {
  await sharedHumanization(message,  fetch, callback, emitError, options)
}

export { callsHumanizer, messageHumanizer, HUMANIZER_META_KEY }
