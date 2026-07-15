import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { parse, stringify } from '../richJson/richJson'
import {
  Erc7730CallDescriptors,
  Erc7730ResolvedDescriptor,
  humanizeCallWithErc7730,
  humanizeMessageWithErc7730
} from './erc7730'
import { HumanizerCallModule, HumanizerMeta, IrCall, IrMessage } from './interfaces'
import {
  cowSwapModule,
  eip7702AuthorizationModule,
  ensMessageModule,
  entryPointModule,
  erc20Module,
  erc721Module,
  legendsMessageModule,
  openseaMessageModule,
  permit2Module,
  safeMessageModule,
  snapshotModule,
  zealyMessageModule
} from './messageModules'
import { fallbackShortPlaintext } from './messageModules/fallbackShortPlaintext'
import OneInchModule from './modules/1Inch'
import { aaveHumanizer } from './modules/Aave'
import AcrossModule from './modules/Across'
import { airdropsModule } from './modules/Airdrops'
import AllowanceModule from './modules/Allowance'
import asciiModule from './modules/AsciiModule'
import Bundler3Module from './modules/Bundler3'
import CowSwapModule from './modules/CowSwap'
import curveModule from './modules/Curve'
import daiPermitModule from './modules/DaiPermit'
import { deploymentModule } from './modules/Deployment'
import { embeddedAmbireOperationHumanizer } from './modules/embeddedAmbireOperationHumanizer'
import { ensModule } from './modules/ENS'
import fallbackHumanizer from './modules/FallbackHumanizer'
import gasTankModule from './modules/GasTankModule'
import GuildModule from './modules/Guild'
import KyberSwap from './modules/KyberSwap'
import legendsModule from './modules/Legends'
import { LidoModule } from './modules/Lido'
import { LifiModule } from './modules/Lifi'
import ModuleProxyFactoryModule from './modules/ModuleProxyFactory'
import { openSeaModule } from './modules/OpenSea'
import PancakeModule from './modules/Pancake'
import { postProcessing } from './modules/PostProcessing/postProcessModule'
import preProcessHumanizer from './modules/PreProcess'
import privilegeHumanizer from './modules/Privileges'
import SafeModule from './modules/Safe'
import singletonFactory from './modules/SingletonFactory'
import { SocketModule } from './modules/Socket'
import sushiSwapModule from './modules/Sushiswap'
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/Tokens'
import traderJoeModule from './modules/TraderJoe'
import TrustlessManifestoModule from './modules/TrustlessManifesto'
import { uniswapHumanizer } from './modules/Uniswap'
import { WALLETModule } from './modules/WALLET'
import wrappingModule from './modules/Wrapping'

// from most generic to least generic
// the final humanization is the final triggered module
export const humanizerCallModules: HumanizerCallModule[] = [
  preProcessHumanizer,
  embeddedAmbireOperationHumanizer,
  deploymentModule,
  genericErc721Humanizer,
  genericErc20Humanizer,
  daiPermitModule,
  TrustlessManifestoModule,
  LidoModule,
  gasTankModule,
  airdropsModule,
  uniswapHumanizer,
  curveModule,
  traderJoeModule,
  KyberSwap,
  CowSwapModule,
  SocketModule,
  LifiModule,
  AcrossModule,
  OneInchModule,
  PancakeModule,
  wrappingModule,
  aaveHumanizer,
  WALLETModule,
  SafeModule,
  Bundler3Module,
  AllowanceModule,
  ModuleProxyFactoryModule,
  privilegeHumanizer,
  sushiSwapModule,
  legendsModule,
  singletonFactory,
  ensModule,
  GuildModule,
  openSeaModule,
  asciiModule,
  fallbackHumanizer,
  postProcessing
]

// from least generic to most generic
// the final visualization and warnings are from the first triggered module
const humanizerTMModules = [
  safeMessageModule,
  erc20Module,
  erc721Module,
  permit2Module,
  cowSwapModule,
  entryPointModule,
  legendsMessageModule,
  ensMessageModule,
  openseaMessageModule,
  zealyMessageModule,
  safeMessageModule,
  eip7702AuthorizationModule,
  snapshotModule,
  fallbackShortPlaintext
]

type HumanizeAccountOpOptions = {
  erc7730Descriptors?: Erc7730CallDescriptors
  nativeAssetSymbol?: string
}

type HumanizeMessageOptions = {
  erc7730Descriptor?: Erc7730ResolvedDescriptor
}

const humanizeAccountOp = (_accountOp: AccountOp, options?: HumanizeAccountOpOptions): IrCall[] => {
  const accountOp = parse(stringify(_accountOp))

  let currentCalls: IrCall[] = accountOp.calls
  humanizerCallModules.forEach((hm) => {
    try {
      currentCalls = hm(accountOp, currentCalls, humanizerInfo as HumanizerMeta)
    } catch (error) {
      console.error(error)
      // No action is needed here; we only set `currentCalls` if the module successfully resolves the calls.
    }
  })

  if (options?.erc7730Descriptors) {
    currentCalls = currentCalls.map((call, index) => {
      const resolvedDescriptor = options.erc7730Descriptors?.[index]
      if (!resolvedDescriptor) return call

      try {
        const originalCall = accountOp.calls[index]
        if (!originalCall) return call

        return (
          humanizeCallWithErc7730(
            originalCall,
            accountOp.chainId,
            accountOp.accountAddr,
            resolvedDescriptor,
            0,
            options.nativeAssetSymbol
          ) || call
        )
      } catch (error) {
        console.error(error)
        return call
      }
    })
  }

  return currentCalls
}

const humanizeMessage = (_message: Message, options?: HumanizeMessageOptions): IrMessage => {
  const message = parse(stringify(_message))

  try {
    if (options?.erc7730Descriptor) {
      const erc7730Message = humanizeMessageWithErc7730(message, options.erc7730Descriptor)
      if (erc7730Message) return erc7730Message
    }

    // runs all modules and takes the first non empty array
    const { fullVisualization, warnings, canHideDropdownArrow } =
      humanizerTMModules
        .map((m) => {
          try {
            return m(message)
          } catch (error) {
            console.error(error)
            return {}
          }
        })
        .filter((p) => p.fullVisualization?.length)[0] || {}

    return { ...message, fullVisualization, warnings, canHideDropdownArrow }
  } catch (error) {
    console.error(error)
    return message
  }
}

export * from './erc7730'
export { humanizeAccountOp, humanizeMessage }
export type { HumanizeAccountOpOptions, HumanizeMessageOptions }
