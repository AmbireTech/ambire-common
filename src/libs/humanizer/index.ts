import { ethers } from 'ethers'
import { AccountOp } from '../accountOp/accountOp'
import {
  IrCall,
  HumanizerFragment,
  HumanizerVisualization,
  HumanizerCallModule
} from './interfaces'
import { PlainTextMessage, TypedMessage } from '../../interfaces/userRequest'
import { getLabel, getDanger, getAction } from './utils'

export function humanizeCalls(
  _accountOp: AccountOp,
  humanizerModules: HumanizerCallModule[],
  options?: any
): [IrCall[], Array<Promise<HumanizerFragment | null>>] {
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
  } catch (e) {
    options.emitError({ message: 'Humanizer: unexpected err', error: e, level: 'major' })
  }
  return [currentCalls, asyncOps]
}

export const visualizationToText = (call: IrCall, options: any): string => {
  let text = ''
  const visualization = call?.fullVisualization
  visualization?.forEach((v: { [key: string]: any }, i: number) => {
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
  accountOp: AccountOp,
  modules: Function[],
  tm: TypedMessage
): HumanizerVisualization[] => {
  // runs all modules and takes the first truthy value
  const visualization = modules.map((m) => m(tm)).filter((p) => p)[0]
  if (accountOp.networkId !== tm.domain.chainId)
    visualization.push(getDanger('Permit on wrong network'))
  return visualization
}

export const humanizePLainTextMessage = (
  accounOp: AccountOp,
  m: PlainTextMessage
): HumanizerVisualization[] => {
  // @TODO
  return []
}
