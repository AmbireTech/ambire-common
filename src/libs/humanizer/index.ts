import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { parse, stringify } from '../richJson/richJson'
import {
  HumanizerCallModule,
  HumanizerMeta,
  HumanizerOptions,
  IrCall,
  IrMessage
} from './interfaces'
import { erc20Module, erc721Module, permit2Module } from './messageModules'
import { entryPointModule } from './messageModules/entryPointModule'
import { legendsMessageModule } from './messageModules/legendsModule'
import OneInchModule from './modules/1Inch'
import { aaveHumanizer } from './modules/Aave'
import AcrossModule from './modules/Across'
import asciiModule from './modules/AsciiModule'
import curveModule from './modules/Curve'
// import { deploymentModule } from './modules/Deployment'
import fallbackHumanizer from './modules/FallbackHumanizer'
import gasTankModule from './modules/GasTankModule'
import KyberSwap from './modules/KyberSwap'
import legendsModule from './modules/Legends'
import { postProcessing } from './modules/PostProcessing/postProcessModule'
import preProcessHumanizer from './modules/PreProcess'
import privilegeHumanizer from './modules/Privileges'
import singletonFactory from './modules/SingletonFactory'
import { SocketModule } from './modules/Socket'
import sushiSwapModule from './modules/Sushiswap'
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/Tokens'
import traderJoeModule from './modules/TraderJoe'
import { uniswapHumanizer } from './modules/Uniswap'
import { WALLETModule } from './modules/WALLET'
import wrappingModule from './modules/Wrapping'

// from most generic to least generic
// the final humanization is the final triggered module
export const humanizerCallModules: HumanizerCallModule[] = [
  preProcessHumanizer,
  // deploymentModule,
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
  legendsModule,
  singletonFactory,
  asciiModule,
  fallbackHumanizer,
  postProcessing
]

// from least generic to most generic
// the final visualization and warnings are from the first triggered module
const humanizerTMModules = [
  erc20Module,
  erc721Module,
  permit2Module,
  entryPointModule,
  legendsMessageModule
]

const humanizeAccountOp = (_accountOp: AccountOp, options: HumanizerOptions): IrCall[] => {
  const accountOp = parse(stringify(_accountOp))
  const humanizerOptions: HumanizerOptions = {
    ...options,
    networkId: accountOp.networkId
  }

  let currentCalls: IrCall[] = accountOp.calls
  humanizerCallModules.forEach((hm) => {
    currentCalls = hm(accountOp, currentCalls, humanizerInfo as HumanizerMeta, humanizerOptions)
  })
  return currentCalls
}

const humanizeMessage = (_message: Message): IrMessage => {
  const message = parse(stringify(_message))

  // runs all modules and takes the first non empty array
  const { fullVisualization, warnings } =
    humanizerTMModules.map((m) => m(message)).filter((p) => p.fullVisualization?.length)[0] || {}

  return { ...message, fullVisualization, warnings }
}

// As of version v4.34.0 HumanizerMetaV2 in storage is no longer needed. It was
// used for persisting learnt data from async operations, triggered by the
// humanization process.
async function clearHumanizerMetaObjectFromStorage(storage: Storage) {
  await storage.remove('HumanizerMetaV2')
}

export { humanizeAccountOp, humanizeMessage, clearHumanizerMetaObjectFromStorage }
