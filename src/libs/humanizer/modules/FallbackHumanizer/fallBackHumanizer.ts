/* eslint-disable no-await-in-loop */
import { Interface, isAddress, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import {
  AbiFragment,
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
  _: AccountOp,
  currentIrCalls: IrCall[],
  humanizerMeta: HumanizerMeta
) => {
  const newCalls = currentIrCalls.map((call) => {
    if (call.fullVisualization && !checkIfUnknownAction(call?.fullVisualization)) return call
    const dappName = call?.meta?.dapp?.name
    const visualization: Array<HumanizerVisualization> = []
    if (call.data !== '0x') {
      let knownSigHash: AbiFragment | undefined
      Object.values(humanizerMeta.abis).some((abi) => {
        Object.values(abi).some((s) => {
          if (s.selector === call.data.slice(0, 10)) {
            knownSigHash = s
            return true
          }
          return false
        })
        return !!knownSigHash
      })

      if (knownSigHash?.signature) {
        let extractedAddresses: string[] = []
        const functionName = knownSigHash.signature
          .split('function ')
          .filter((x) => x !== '')[0]
          .split('(')
          .filter((x) => x !== '')[0]
        try {
          extractedAddresses = extractAddresses(call.data, knownSigHash.signature)
          visualization.push(
            ...extractedAddresses.map((a) => ({ ...getToken(a, 0n), isHidden: true }))
          )
        } catch (e) {
          console.error('Humanizer: fallback: Could not decode addresses from calldata')
        }
        if (dappName) visualization.push(getAction(`${dappName}: ${functionName}`))
        else visualization.push(getAction(`Call ${functionName} function`))
      } else {
        // eslint-disable-next-line no-lonely-if
        if (dappName) visualization.push(getAction(`${dappName}: unknown call`))
        else visualization.push(getAction('Unknown call to'), getAddressVisualization(call.to))
      }
    }
    if (call.value) {
      if (call.data !== '0x')
        visualization.push(getLabel('with'), getToken(ZeroAddress, call.value))
      else visualization.push(getAction('Send'), getLabel('to'), getAddressVisualization(call.to))
    }
    return {
      ...call,
      fullVisualization: visualization.length
        ? visualization
        : [getAction('No data, no value, call to'), getAddressVisualization(call.to)]
    }
  })

  return newCalls
}
