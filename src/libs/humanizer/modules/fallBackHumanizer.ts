/* eslint-disable no-await-in-loop */
import { ethers } from 'ethers'
import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerFragment, Ir } from '../interfaces'
import { getAction, getAddress, getLable, getToken } from '../utils'

async function fetchFuncEtherface(
  selector: string,
  fetch: Function
): Promise<HumanizerFragment | null> {
  // @TODO to be emited as err
  if (!fetch) console.log('fetchFuncEtherface: not passed fetch')
  let res
  // often fails due to timeout => loop for retrying
  for (let i = 0; i < 3; i++) {
    try {
      res = await (
        await fetch(`https://api.etherface.io/v1/signatures/hash/all/${selector.slice(2, 10)}/1`, {
          timeout: 10000
        })
      ).json()
      break
    } catch (e: any) {
      // @TODO to throw err, caught by try catch in controller
      console.log(`fetchFuncEtherface: ${e.message}`)
    }
  }
  const func = res?.items?.[0]
  return func
    ? {
        key: `funcSelectors:${selector}`,
        isGlobal: true,
        value: func.text
      }
    : null
}
const checkIfUnknowAction = (v: Array<any>) => {
  try {
    return v.length === 1 && v[0].type === 'action' && v[0].content.startsWith('Unknown action')
  } catch (e) {
    return false
  }
}

export function fallbackHumanizer(
  accountOp: AccountOp,
  currentIr: Ir,
  options?: any
): [Ir, Promise<any>[]] {
  const asyncOps: any = []
  const newCalls = currentIr.calls.map((call) => {
    if (call.fullVisualization && !checkIfUnknowAction(call.fullVisualization)) return call
    const visualization = []
    if (call.data !== '0x') {
      if (accountOp.humanizerMeta?.[`funcSelectors:${call.data.slice(0, 10)}`]) {
        visualization.push(
          getAction(`${accountOp.humanizerMeta?.[`funcSelectors:${call.data.slice(0, 10)}`]} to`)
        )
      } else {
        const promise = fetchFuncEtherface(call.data.slice(0, 10), options.fetch)
        promise ? asyncOps.push(promise) : null
        return { ...call, fullVisualization: [getAction('Unknown action')] }
      }
    }
    if (call.value) {
      if (call.data !== '0x') visualization.push(getLable('and'))
      visualization.push(getAction('Sending'))
      visualization.push(getToken(ethers.ZeroAddress, call.value))
    }
    visualization.push(getLable('to'))
    visualization.push(getAddress(call.to))
    return { ...call, fullVisualization: visualization }
  })

  const newIr = { calls: newCalls }
  return [newIr, asyncOps]
}
