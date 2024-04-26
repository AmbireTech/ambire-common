/* eslint-disable no-await-in-loop */
import { Interface, isAddress, ZeroAddress } from 'ethers'

import { AccountOp } from '../../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerFragment,
  HumanizerMeta,
  HumanizerPromise,
  HumanizerVisualization,
  IrCall
} from '../interfaces'
import {
  checkIfUnknownAction,
  getAction,
  getAddressVisualization,
  getLabel,
  getToken
} from '../utils'

// @TODO add again
// etherface was down for some time and we replaced it with 4bytes
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      type: 'selector',
      key: selector,
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
      res = await options
        .fetch(
          `https://www.4byte.directory/api/v1/signatures/?format=json&hex_signature=${selector.slice(
            2,
            10
          )}`,
          {
            // test allow aup to 25000 ms (this value * iterations of the loop)
            timeout: 7500
          }
        )
        .then((r: any) => r.json())
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
      type: 'selector',
      key: func.hex_signature,
      isGlobal: true,
      value: { signature: func.text_signature, selector: func.hex_signature }
    }
  options.emitError({
    message: `fetchFunc4bytes: Err with 4bytes api, selector ${selector.slice(0, 10)}`,
    error: new Error(`Failed to fetch info from 4bytes's api about ${selector.slice(0, 10)}`),
    level: 'silent'
  })
  return null
}

function extractAddresses(data: string, _selector: string): string[] {
  const selector = _selector.startsWith('function') ? _selector : `function ${_selector}`
  const iface = new Interface([selector])
  const args = iface.decodeFunctionData(selector, data)
  const deepSearchForAddress = (obj: { [prop: string]: any }): string[] => {
    return (
      Object.values(obj)
        .map((o: any): string[] | undefined => {
          if (typeof o === 'string' && isAddress(o)) return [o] as string[]
          if (typeof o === 'object') return deepSearchForAddress(o).filter((x) => x) as string[]
          return undefined
        })
        .filter((x) => x) as string[][]
    ).flat() as string[]
  }
  return deepSearchForAddress(args)
}

export const fallbackHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  humanizerMeta: HumanizerMeta,
  options?: any
) => {
  const asyncOps: HumanizerPromise[] = []
  const newCalls = currentIrCalls.map((call) => {
    if (call.fullVisualization && !checkIfUnknownAction(call?.fullVisualization)) return call

    const knownSigHashes: HumanizerMeta['abis']['NO_ABI'] = Object.values(
      humanizerMeta.abis as HumanizerMeta['abis']
    ).reduce((a, b) => ({ ...a, ...b }), {})

    const visualization: Array<HumanizerVisualization> = []
    if (call.data !== '0x') {
      let extractedAddresses: string[] = []
      try {
        if (knownSigHashes[call.data.slice(0, 10)]?.signature)
          extractedAddresses = extractAddresses(
            call.data,
            knownSigHashes[call.data.slice(0, 10)].signature
          )
      } catch (e) {
        options.emitError({
          message: 'Failed to extract addresses and token from this txn',
          level: 'minor',
          error: new Error(
            `Internal error fallback module: Failed to extract addresses and token from this txn ${e}`
          )
        })
      }
      if (knownSigHashes[call.data.slice(0, 10)]) {
        visualization.push(
          getAction(
            `Call ${
              //  from function asd(address asd) returns ... => asd(address asd)
              knownSigHashes[call.data.slice(0, 10)].signature
                .split('function ')
                .filter((x) => x !== '')[0]
                .split(' returns')
                .filter((x) => x !== '')[0]
            }`
          ),
          getLabel('from'),
          getAddressVisualization(call.to),
          ...extractedAddresses.map(
            (a): HumanizerVisualization => ({ ...getToken(a, 0n), isHidden: true })
          )
        )
      } else {
        asyncOps.push(() => fetchFunc4bytes(call.data.slice(0, 10), options))

        visualization.push(
          getAction('Unknown action'),
          getLabel('to'),
          getAddressVisualization(call.to)
        )
      }
    }
    if (call.value) {
      if (call.data !== '0x') visualization.push(getLabel('and'))
      visualization.push(getAction('Send'), getToken(ZeroAddress, call.value))
      if (call.data === '0x') visualization.push(getLabel('to'), getAddressVisualization(call.to))
    }
    return {
      ...call,
      fullVisualization: visualization.length
        ? visualization
        : [getAction('No data, no value, call to'), getAddressVisualization(call.to)]
    }
  })

  return [newCalls, asyncOps]
}
