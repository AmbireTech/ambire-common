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
  HumanizerMeta,
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

export const HUMANIZER_META_KEY = 'HumanizerMetaV2'
// generic in the begining
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

// generic at the end
// the final visualization and warnings are from the first triggered module
const humanizerTMModules = [erc20Module, erc721Module, permit2Module, fallbackEIP712Humanizer]

const integrateFragments = (
  _humanizerMeta: HumanizerMeta,
  fragments: HumanizerFragment[]
): HumanizerMeta => {
  const humanizerMeta = _humanizerMeta
  fragments.forEach((f) => {
    // @TODO rename types to singular  also add enum
    if (f.type === 'abis') humanizerMeta.abis[f.key] = f.value
    if (f.type === 'selector') humanizerMeta.abis.NO_ABI[f.key] = f.value
    if (f.type === 'knownAddresses')
      humanizerMeta.knownAddresses[f.key] = { ...humanizerMeta.knownAddresses[f.key], ...f.value }
    if (f.type === 'token') {
      humanizerMeta.knownAddresses[f.key] = {
        ...humanizerMeta.knownAddresses?.[f.key],
        token: f.value
      }
    }
  })
  return humanizerMeta
}

// @TODO move to constants????
export const combineKnownHumanizerInfo = (
  stored: HumanizerMeta,
  passedHumanizerMeta: HumanizerMeta | undefined,
  humanizerFragments?: HumanizerFragment[]
): { toStore: HumanizerMeta; toReturn: HumanizerMeta } => {
  const globalFrags = humanizerFragments?.filter((f) => f.isGlobal) || []
  const nonGlobalFragments = humanizerFragments?.filter((f) => !f.isGlobal) || []

  const toStore: HumanizerMeta = integrateFragments(stored, globalFrags)

  const toReturn = integrateFragments(toStore, nonGlobalFragments)
  toReturn.abis.NO_ABI = { ...toReturn?.abis?.NO_ABI, ...passedHumanizerMeta?.abis?.NO_ABI }
  toReturn.knownAddresses = { ...toReturn?.knownAddresses, ...passedHumanizerMeta?.knownAddresses }
  // this operation should only append and not override
  toReturn.abis = { ...passedHumanizerMeta?.abis, ...toReturn?.abis }

  return { toStore, toReturn }
}

export const humanizeAccountOp = async (
  storage: Storage,
  accountOp: AccountOp,
  fetch: Function,
  emitError: Function
): Promise<IrCall[]> => {
  const storedHumanizerMeta = await storage.get(HUMANIZER_META_KEY, {})

  const [irCalls] = humanizeCalls(
    { ...accountOp!, humanizerMeta: { ...accountOp!.humanizerMeta, ...storedHumanizerMeta } },
    humanizerCallModules,
    { fetch, emitError }
  )

  return irCalls
}

// @TODO: update iterface name
export const sharedHumanization = async <InputData extends AccountOp | Message>(
  data: InputData,
  storage: Storage,
  fetch: Function,
  callback: ((response: IrCall[]) => void) | ((response: IrMessage) => void),
  emitError: (err: ErrorRef) => void
) => {
  let humanizerFragments: HumanizerFragment[] = []
  let op: AccountOp
  let irCalls
  let asyncOps: Promise<HumanizerFragment | null>[] = []
  let parsedMessage: IrMessage
  if ('calls' in data) {
    op = parse(stringify(data))
  }

  const storedHumanizerMeta = await storage.get(HUMANIZER_META_KEY, {
    knownAddresses: {},
    abis: { NO_ABI: {} }
  } as HumanizerMeta)

  for (let i = 0; i <= 3; i++) {
    // @TODO should we always do this

    const { toReturn: toBeUsed, toStore } = combineKnownHumanizerInfo(
      storedHumanizerMeta,
      data.humanizerMeta as HumanizerMeta | undefined,
      humanizerFragments
    )
    if ('calls' in data) {
      op!.humanizerMeta = toBeUsed
      ;[irCalls, asyncOps] = humanizeCalls(op!, humanizerCallModules, { fetch, emitError })
      const [parsedCalls, newAsyncOps] = parseCalls(op!, irCalls, parsingModules, {
        fetch,
        emitError
      })
      asyncOps.push(...newAsyncOps)
      ;(callback as (response: IrCall[]) => void)(parsedCalls)
    } else if ('content' in data) {
      const humanizerSettings: HumanizerSettings = {
        accountAddr: data.accountAddr,
        networkId: data?.networkId || 'ethereum',
        humanizerMeta: toBeUsed
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

    humanizerFragments = await Promise.all(asyncOps).then(
      (frags) => frags.filter((x) => x) as HumanizerFragment[]
    )
    await storage.set(HUMANIZER_META_KEY, toStore)
    if (!humanizerFragments.length) return
  }
}

export const callsHumanizer = async (
  accountOp: AccountOp,
  storage: Storage,
  fetch: Function,
  callback: (irCalls: IrCall[]) => void,
  emitError: (err: ErrorRef) => void
) => {
  await sharedHumanization(accountOp, storage, fetch, callback, emitError)
}

export const messageHumanizer = async (
  message: Message,
  storage: Storage,
  fetch: Function,
  callback: (msgs: IrMessage) => void,
  emitError: (err: ErrorRef) => void
) => {
  await sharedHumanization(message, storage, fetch, callback, emitError)
}
