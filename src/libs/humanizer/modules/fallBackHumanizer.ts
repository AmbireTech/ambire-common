/* eslint-disable no-await-in-loop */
import { ethers } from 'ethers'
import { AccountOp } from '../../accountOp/accountOp'
import {
  HumanizerFragment,
  HumanizerCallModule,
  HumanizerVisualization,
  IrCall
} from '../interfaces'
import { checkIfUnknownAction, getAction, getAddress, getLabel, getToken } from '../utils'

async function fetchFuncEtherface(
  selector: string,
  options: any
): Promise<HumanizerFragment | null> {
  if (!options.fetch)
    return options.emitError({
      message: 'fetchFuncEtherface: no fetch function passed',
      error: new Error('No fetch function passed to fetchFuncEtherface'),
      level: 'major'
    })
  let res
  // often fails due to timeout => loop for retrying
  for (let i = 0; i < 3; i++) {
    try {
      res = await (
        await options.fetch(
          `https://api.etherface.io/v1/signatures/hash/all/${selector.slice(2, 10)}/1`,
          {
            // test allow aup to 25000 ms (this value * iterations of the loop)
            timeout: 7500
          }
        )
      ).json()
      break
    } catch (e: any) {
      options.emitError({
        message: 'fetchFuncEtherface: problem with etherface api',
        error: e,
        level: 'silent'
      })
    }
  }
  const func = res?.items?.[0]
  if (func)
    return {
      key: `funcSelectors:${selector}`,
      isGlobal: true,
      value: func.text
    }
  options.emitError({
    message: `fetchFuncEtherface: Err with etherface api, selector ${selector.slice(0, 10)}`,
    error: new Error(`Failed to fetch info from etherface's api about ${selector.slice(0, 10)}`),
    level: 'silent'
  })
  return null
}

async function fetchFunc4bytes(selector: string, options: any): Promise<HumanizerFragment | null> {
  if (!options.fetch)
    return options.emitError({
      message: 'fetchFunc4bytes: no fetch function passed',
      error: new Error('No fetch function passed to fetchFunc4bytes'),
      level: 'major'
    })
  let res
  // often fails due to timeout => loop for retrying
  for (let i = 0; i < 3; i++) {
    try {
      res = await (
        await options.fetch(
          `https://www.4byte.directory/api/v1/signatures/?format=json&hex_signature=${selector.slice(
            2,
            10
          )}`,
          {
            // test allow aup to 25000 ms (this value * iterations of the loop)
            timeout: 7500
          }
        )
      ).json()
      break
    } catch (e: any) {
      options.emitError({
        message: 'fetchFunc4bytes: problem with 4bytes api',
        error: e,
        level: 'silent'
      })
    }
  }
  let func
  try {
    func = res.results.reduce((minObject: any, currentObject: any) => {
      return currentObject.id < minObject.id ? currentObject : minObject
    }, res.results[0])
  } catch (e) {
    options.emitError({
      message: `fetchFunc4bytes: Err with 4bytes api, selector ${selector.slice(0, 10)}`,
      error: new Error(`Failed to fetch info from 4bytes's api about ${selector.slice(0, 10)}`),
      level: 'silent'
    })
  }
  if (func)
    return {
      key: `funcSelectors:${func.hex_signature}`,
      isGlobal: true,
      value: func.text_signature
    }
  options.emitError({
    message: `fetchFunc4bytes: Err with 4bytes api, selector ${selector.slice(0, 10)}`,
    error: new Error(`Failed to fetch info from 4bytes's api about ${selector.slice(0, 10)}`),
    level: 'silent'
  })
  return null
}

export const fallbackHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  options?: any
) => {
  const asyncOps: Promise<HumanizerFragment | null>[] = []
  const newCalls = currentIrCalls.map((call) => {
    if (call.fullVisualization && !checkIfUnknownAction(call?.fullVisualization)) return call

    const visualization: Array<HumanizerVisualization> = []
    if (call.data !== '0x') {
      if (accountOp.humanizerMeta?.[`funcSelectors:${call.data.slice(0, 10)}`]) {
        visualization.push(
          getAction(`Call ${accountOp.humanizerMeta?.[`funcSelectors:${call.data.slice(0, 10)}`]}`),
          getLabel('from'),
          getAddress(call.to)
        )
      } else {
        // const promise = fetchFuncEtherface(call.data.slice(0, 10), options)
        const promise = fetchFunc4bytes(call.data.slice(0, 10), options)
        asyncOps.push(promise)

        visualization.push(getAction('Unknown action'), getLabel('to'), getAddress(call.to))
      }
    }
    if (call.value) {
      if (call.data !== '0x') visualization.push(getLabel('and'))
      visualization.push(getAction('Send'), getToken(ethers.ZeroAddress, call.value))
      if (call.data === '0x') visualization.push(getLabel('to'), getAddress(call.to))
    }
    return {
      ...call,
      fullVisualization: visualization.length
        ? visualization
        : [getAction('No data, no value, call to'), getAddress(call.to)]
    }
  })

  return [newCalls, asyncOps]
}
