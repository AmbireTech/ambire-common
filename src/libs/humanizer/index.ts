/* eslint-disable no-await-in-loop */
import dotenv from 'dotenv'
import { networks } from '../../consts/networks'
import { ErrorRef } from '../../controllers/eventEmitter'
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
  IrMessage,
  KnownAddressLabels
} from './interfaces'
import { aaveHumanizer } from './modules/Aave'
import { fallbackHumanizer } from './modules/fallBackHumanizer'
import { gasTankModule } from './modules/gasTankModule'
import { sushiSwapModule } from './modules/sushiSwapModule'
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/tokens'
import { uniswapHumanizer } from './modules/Uniswap'
// import { oneInchHumanizer } from '.modules/oneInch'
import { WALLETModule } from './modules/WALLET'
import { wrappingModule } from './modules/wrapped'
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
import { redefineCallsCheck } from './utils'

dotenv.config()

const REDEFINE_API_KEY = process.env.REDEFINE_API_KEY!
const HUMANIZER_META_KEY = 'HumanizerMeta'
// generic in the begining
// the final humanization is the final triggered module
const humanizerCallModules: HumanizerCallModule[] = [
  genericErc20Humanizer,
  genericErc721Humanizer,
  gasTankModule,
  uniswapHumanizer,
  wrappingModule,
  aaveHumanizer,
  // oneInchHumanizer,
  WALLETModule,
  yearnVaultModule,
  sushiSwapModule,
  fallbackHumanizer
]

const parsingModules: HumanizerParsingModule[] = [nameParsing, tokenParsing]

// generic at the end
// the final visualization and warnings are from the first triggered module
const humanizerTMModules = [erc20Module, erc721Module, permit2Module, fallbackEIP712Humanizer]
// @TODOD add test for this
const checkRedefine = async (
  accountOp: AccountOp,
  irCalls: IrCall[],
  callback: Function,
  options?: any
) => {
  const newCalls = await Promise.all(
    irCalls.map(async (call: IrCall) => {
      // @TODO make helper
      const res: any = await redefineCallsCheck(
        accountOp.accountAddr,
        call,
        accountOp.networkId,
        REDEFINE_API_KEY,
        options
      )
      // @NOTE to be removed once redefine start returning err statuses on all error cases
      if (!res) return call
      res?.data?.insights?.issues?.length &&
        call.warnings?.push(
          ...res.data.insights.issues.map((issue: any) => ({
            content: issue.description.short as string,
            level:
              { '1': 'caution', '2': 'caution', '3': 'alarm', '4': 'alert' }[
                issue?.severity?.code?.toString() as string
              ] || 'alert'
          }))
        )
      // false on [], true on null/undefined
      !res?.data?.insights?.issues &&
        options.emitError({
          level: 'silent',
          message: `Error with redefine's API, ${JSON.stringify(res)} but status 200`,
          error: new Error(`Error with redefine's API ${JSON.stringify(res)}`)
        })
      return call
    })
  )
  callback(newCalls)
}
const handleAsyncOps = async (
  asyncOps: Promise<HumanizerFragment | null>[],
  storage: Storage,
  storedHumanizerMeta: any
) => {
  let globalFragmentData = {}
  let nonGlobalFragmentData = {}
  const fragments = (await Promise.all(asyncOps)).filter((f) => f) as HumanizerFragment[]
  if (!fragments.length) [{}, {}]

  // eslint-disable-next-line @typescript-eslint/no-loop-func
  fragments.forEach((f) => {
    f.isGlobal
      ? (globalFragmentData = { ...globalFragmentData, [f.key]: f.value })
      : (nonGlobalFragmentData = { ...nonGlobalFragmentData, [f.key]: f.value })
  })

  await storage.set(HUMANIZER_META_KEY, { ...storedHumanizerMeta, ...globalFragmentData })
  return [globalFragmentData, nonGlobalFragmentData]
}

export const sharedHumanization = async <Data extends AccountOp | Message>(
  data: Data,
  knownAddressLabel: { [addr in string]: string },
  storage: Storage,
  fetch: Function,
  callback: ((response: IrCall[]) => void) | ((response: IrMessage) => void),
  emitError: (err: ErrorRef) => void
) => {
  let globalFragmentData = {}
  let nonGlobalFragmentData = {}
  let op: AccountOp
  let irCalls
  let asyncOps: Promise<HumanizerFragment | null>[] = []
  let parsedMessage: IrMessage
  if ('calls' in data) {
    op = {
      ...data,
      humanizerMeta: {
        ...(await storage.get(HUMANIZER_META_KEY, {})),
        ...Object.fromEntries(
          Object.entries(knownAddressLabel).map(([addr, label]) => {
            return [`names:${addr}`, label]
          })
        ),
        ...data.humanizerMeta
      }
    }
  }
  for (let i = 0; i <= 3; i++) {
    const storedHumanizerMeta = await storage.get(HUMANIZER_META_KEY, {})
    if ('calls' in data) {
      op!.humanizerMeta = {
        ...op!.humanizerMeta,
        ...nonGlobalFragmentData
      }
      ;[irCalls, asyncOps] = humanizeCalls(
        { ...op!, humanizerMeta: { ...op!.humanizerMeta, ...storedHumanizerMeta } },
        humanizerCallModules,
        { fetch, emitError }
      )
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
        humanizerMeta: {
          ...(await storage.get(HUMANIZER_META_KEY, {})),
          ...Object.fromEntries(
            Object.entries(knownAddressLabel).map(([addr, label]) => {
              return [`names:${addr}`, label]
            })
          ),
          ...data.humanizerMeta,
          ...nonGlobalFragmentData
        }
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

    ;[globalFragmentData, nonGlobalFragmentData] = await handleAsyncOps(
      asyncOps,
      storage,
      storedHumanizerMeta
    )
    if (!Object.keys(globalFragmentData).length && !Object.keys(nonGlobalFragmentData).length)
      return
  }
}

export const callsHumanizer = async (
  accountOp: AccountOp,
  knownAddressLabels: KnownAddressLabels,
  storage: Storage,
  fetch: Function,
  callback: (irCalls: IrCall[]) => void,
  emitError: (err: ErrorRef) => void
) => {
  let humanizedCalls: IrCall[] = []
  await sharedHumanization(
    accountOp,
    knownAddressLabels,
    storage,
    fetch,
    (irCalls: IrCall[]) => {
      humanizedCalls = irCalls
      callback(irCalls)
    },
    emitError
  )
  await checkRedefine(accountOp, humanizedCalls, callback, { emitError, fetch }).catch(console.log)
}

export const messageHumanizer = async (
  message: Message,
  knownAddressLabels: KnownAddressLabels,
  storage: Storage,
  fetch: Function,
  callback: (msgs: IrMessage) => void,
  emitError: (err: ErrorRef) => void
) => {
  await sharedHumanization(message, knownAddressLabels, storage, fetch, callback, emitError)
}
