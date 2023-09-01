import { ethers } from 'ethers'
import { AccountOp } from '../accountOp/accountOp'
import { IrCall, Ir, HumanizerFragment } from './interfaces'

// @TODO humanize signed messages
export function callsToIr(accountOp: AccountOp): Ir {
  const irCalls: IrCall[] = accountOp.calls.map((call) => {
    return {
      data: call.data,
      to: call.to,
      value: call.value
    }
  })
  return { calls: irCalls }
}

export function humanize(
  _accountOp: AccountOp,
  humanizerModules: Function[],
  options?: any
): [Ir, Array<Promise<HumanizerFragment | null>>] {
  const accountOp = {
    ..._accountOp,
    calls: _accountOp.calls.map((c) => ({ ...c, to: ethers.getAddress(c.to) }))
  }
  let currentIr: Ir = callsToIr(accountOp)
  let asyncOps: Promise<HumanizerFragment>[] = []
  try {
    humanizerModules.forEach((hm) => {
      let newPromises = []
      ;[currentIr, newPromises] = hm(accountOp, currentIr, options)
      asyncOps = [...asyncOps, ...newPromises]
    })
  } catch (e) {
    options.emitError({ message: 'Humanizer: unexpected err', error: e, level: 'major' })
  }
  return [currentIr, asyncOps]
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
