/* eslint-disable no-await-in-loop */
import { Interface, isAddress, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerMeta,
  HumanizerVisualization,
  IrCall
} from '../../interfaces'
import {
  checkIfUnknownAction,
  getAction,
  getAddressVisualization,
  getLabel,
  getToken
} from '../../utils'

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
  humanizerMeta: HumanizerMeta
) => {
  const newCalls = currentIrCalls.map((call) => {
    if (!call.to)
      return {
        ...call,
        fullVisualization: [getAction('Deploy contract')]
      }
    if (call.fullVisualization && !checkIfUnknownAction(call?.fullVisualization)) return call

    const knownSigHashes: HumanizerMeta['abis']['NO_ABI'] = Object.values(
      humanizerMeta.abis as HumanizerMeta['abis']
    ).reduce((a, b) => ({ ...a, ...b }), {})

    const visualization: Array<HumanizerVisualization> = []
    if (call.data !== '0x') {
      let extractedAddresses: string[] = []
      if (knownSigHashes[call.data.slice(0, 10)]?.signature) {
        try {
          extractedAddresses = extractAddresses(
            call.data,
            knownSigHashes[call.data.slice(0, 10)].signature
          )
        } catch (e) {
          console.error('Humanizer: fallback: Could not decode addresses from calldata')
        }
        visualization.push(
          getAction(
            `Call ${
              //  from function asd(address asd) returns ... => asd(address asd)
              knownSigHashes[call.data.slice(0, 10)].signature
                .split('function ')
                .filter((x) => x !== '')[0]
                .split('(')
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
        visualization.push(
          getAction('Interacting'),
          getLabel('with'),
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
        : [getAction('Empty call to'), getAddressVisualization(call.to)]
    }
  })

  return newCalls
}
