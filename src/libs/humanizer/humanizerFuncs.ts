import { formatUnits } from 'ethers'

import { MAX_UINT256 } from '../../consts/deploy'
import { ErrorRef } from '../../controllers/eventEmitter/eventEmitter'
import { Message, PlainTextMessage, TypedMessage } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerMeta,
  HumanizerPromise,
  HumanizerTypedMessaageModule,
  HumanizerVisualization,
  IrCall,
  IrMessage
} from './interfaces'
import { getAction, getDeadlineText, getLabel, integrateFragments } from './utils'

export function humanizeCalls(
  _accountOp: AccountOp,
  humanizerModules: HumanizerCallModule[],
  _humanizerMeta: HumanizerMeta,
  options?: any
): [IrCall[], HumanizerPromise[], ErrorRef | null] {
  let error = null
  const accountOp = {
    ..._accountOp,
    calls: _accountOp.calls.map((c) => ({ ...c, to: c.to }))
  }
  const humanizerMeta = integrateFragments(_humanizerMeta, accountOp.humanizerMetaFragments || [])

  let currentCalls: IrCall[] = accountOp.calls
  let asyncOps: HumanizerPromise[] = []
  try {
    humanizerModules.forEach((hm) => {
      let newPromises = []
      ;[currentCalls, newPromises] = hm(accountOp, currentCalls, humanizerMeta, options)
      asyncOps = [...asyncOps, ...newPromises]
    })
  } catch (e: any) {
    error = {
      message: 'Humanizer: unexpected err',
      error: e as Error,
      level: 'major' as ErrorRef['level']
    }
  }
  return [currentCalls, asyncOps, error]
}

export const visualizationToText = (call: IrCall, options: any): string => {
  let text = ''
  const visualization = call?.fullVisualization
  visualization?.forEach((v: HumanizerVisualization, i: number) => {
    // if not first iteration
    if (i) text += ' '
    if (v.type === 'action' || v.type === 'label') text += `${v.content}`
    if (v.type === 'address')
      text += v?.humanizerMeta?.name ? `${v.address} (${v?.humanizerMeta?.name})` : v.address
    if (v.type === 'token') {
      if (v.humanizerMeta?.token) {
        if (v.amount === MAX_UINT256) {
          text += `all ${
            v.humanizerMeta.token?.symbol ? v.humanizerMeta.token?.symbol : `${v.address} token`
          }`
        } else {
          text += `${formatUnits(v.amount!, v.humanizerMeta.token.decimals)} ${
            v.humanizerMeta.token?.symbol ? v.humanizerMeta.token?.symbol : `${v.address} token`
          }`
        }
      } else if (v.amount === MAX_UINT256) {
        text += `all ${v.address} token`
      } else {
        text += `${v.amount} ${v.address} token`
      }
    }
    if (v.type === 'deadline') {
      text += getDeadlineText(v.amount!)
    }
  })
  if (text) {
    return text
  }
  options.emitError({
    message: 'visualizationToText: Something went wrong with humanization',
    errror: new Error(`visualizationToText couldn't convert the txn to text, ${call}`),
    level: 'silent'
  })
  return `Call to ${call.to} with ${call.value} value and ${call.data} data`
}

export const humanizeTypedMessage = (
  modules: HumanizerTypedMessaageModule[],
  tm: TypedMessage
  // only fullVisualization and warnings
): Omit<IrMessage, keyof Message> => {
  // runs all modules and takes the first non empty array
  const { fullVisualization, warnings } = modules
    .map((m) => m(tm))
    .filter((p) => p.fullVisualization?.length)[0]
  return { fullVisualization, warnings }
}

export const humanizePlainTextMessage = (
  m: PlainTextMessage
  // only full visualization and warnings
): Omit<IrMessage, keyof Message> => ({
  fullVisualization: [getAction('Sign message:'), getLabel(m.params.message as string)],
  warnings: []
})
