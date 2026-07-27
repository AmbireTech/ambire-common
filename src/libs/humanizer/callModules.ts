import { HumanizerCallModule } from './interfaces'
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

// These modules describe a single call and are safe to reuse for calldata nested in a container.
// Container expansion and final fallback/post-processing remain exclusive to the top-level pipeline.
export const singleCallHumanizerModules: HumanizerCallModule[] = [
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
  asciiModule
]

// from most generic to least generic
// the final humanization is the final triggered module
export const humanizerCallModules: HumanizerCallModule[] = [
  preProcessHumanizer,
  embeddedAmbireOperationHumanizer,
  deploymentModule,
  ...singleCallHumanizerModules,
  fallbackHumanizer,
  postProcessing
]
