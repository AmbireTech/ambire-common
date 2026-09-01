import MetaMorphoModule from '@/libs/humanizer/modules/MetaMorpho'

import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, IrCall } from './interfaces'
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

// The modules that describe a single call. Kept separate only to compose `humanizerCallModules`
// below - every caller runs the whole pipeline through `humanizeCallWithModules`.
const singleCallHumanizerModules: HumanizerCallModule[] = [
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
  MetaMorphoModule,
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

/**
 * Describes one call with the humanizer modules - the humanization every call gets when no ERC-7730
 * descriptor covers it.
 *
 * The modules run in order, each seeing what the previous one produced, so the least generic module
 * that matches has the final say. A module that throws is skipped and the call keeps the description
 * it already had, because one broken decoder must not lose the whole call.
 *
 * This is the single entry point for it: a nested call decoded inside an ERC-7730 descriptor is
 * described by exactly the same modules, in the same order, as a top-level one.
 */
export const humanizeCallWithModules = (accountOp: AccountOp, call: IrCall): IrCall =>
  humanizerCallModules.reduce<IrCall>((currentCall, humanizeWithModule) => {
    try {
      return humanizeWithModule(accountOp, currentCall, humanizerInfo as HumanizerMeta)
    } catch (error) {
      console.error(error)
      // No action is needed here; we only update `currentCall` if the module successfully resolves it.
      return currentCall
    }
  }, call)
