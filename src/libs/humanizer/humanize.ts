import { ethers } from 'ethers'

import { ErrorRef } from '../../controllers/eventEmitter'
import { PlainTextMessage, TypedMessage } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerFragment,
  HumanizerTypedMessaageModule,
  HumanizerVisualization,
  IrCall
} from './interfaces'
import { getAction, getLabel } from './utils'

export function humanizeCalls(
  _accountOp: AccountOp,
  humanizerModules: HumanizerCallModule[],
  options?: any
): [IrCall[], Array<Promise<HumanizerFragment | null>>, ErrorRef | null] {
  let error = null
  const accountOp = {
    ..._accountOp,
    calls: _accountOp.calls.map((c) => ({ ...c, to: ethers.getAddress(c.to) }))
  }
  let currentCalls: IrCall[] = accountOp.calls
  let asyncOps: Promise<HumanizerFragment | null>[] = []
  try {
    humanizerModules.forEach((hm) => {
      let newPromises = []
      ;[currentCalls, newPromises] = hm(accountOp, currentCalls, options)
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
  visualization?.forEach((v: { [key: string]: any }, i: number) => {
    // if not first iteration
    if (i) text += ' '
    if (v.type === 'action' || v.type === 'label') text += `${v.content}`
    if (v.type === 'address') text += v.name ? `${v.address} (${v.name})` : v.address
    if (v.type === 'token') {
      text += `${v.readableAmount || v.amount} ${v.symbol ? v.symbol : `${v.address} token`}`
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
): HumanizerVisualization[] => {
  // runs all modules and takes the first truthy value
  const visualization: HumanizerVisualization[] = modules
    .map((m) => m(tm))
    .filter((p) => p.length)[0]
  return visualization
}

export const humanizePLainTextMessage = (m: PlainTextMessage): HumanizerVisualization[] => {
  return [getAction('Sign message:'), getLabel(m.message as string)]
}
