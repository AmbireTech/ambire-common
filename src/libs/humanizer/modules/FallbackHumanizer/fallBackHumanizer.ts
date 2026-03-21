/* eslint-disable no-await-in-loop */
import { Interface, isAddress, ZeroAddress } from 'ethers'

import humanizerMeta from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerMeta,
  HumanizerVisualization,
  IrCall
} from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'

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

const knownSigHashes: HumanizerMeta['abis']['NO_ABI'] = Object.values(
  (humanizerMeta as HumanizerMeta).abis as HumanizerMeta['abis']
).reduce((a, b) => ({ ...a, ...b }), {})

export const fallbackHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[]
) => {
  const newCalls = currentIrCalls.map((call) => {
    let fullVisualization = []
    if (!call.to) fullVisualization = [getAction('Deploy contract')]
    else if (call.fullVisualization?.length) fullVisualization = call.fullVisualization
    else {
      if (call.data !== '0x') {
        let extractedAddresses: string[] = []
        const foundSignature = knownSigHashes[call.data.slice(0, 10)]?.signature
        if (foundSignature && typeof foundSignature === 'string') {
          try {
            extractedAddresses = extractAddresses(call.data, foundSignature)
          } catch (e) {
            console.error('Humanizer: fallback: Could not decode addresses from calldata')
          }
          fullVisualization.push(
            getAction(
              `Call ${
                //  from function asd(address asd) returns ... => asd(address asd)
                foundSignature
                  .split('function ')
                  .filter((x) => x !== '')[0]
                  ?.split('(')
                  .filter((x) => x !== '')[0]
                  ?.split(' returns')
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
          fullVisualization.push(
            getAction('Interacting'),
            getLabel('with'),
            getAddressVisualization(call.to)
          )
        }
      }
    }

    if (
      call.value &&
      (!fullVisualization.length ||
        !['Swap', 'Bridge', 'Swap/Bridge', 'Supply', 'Deposit', 'Supply to vault', 'Wrap'].includes(
          fullVisualization[0]?.content || ''
        ))
    ) {
      if (fullVisualization.length) fullVisualization.push(getLabel('and'))
      fullVisualization.push(getAction('Send'), getToken(ZeroAddress, call.value))
      if (call.data === '0x' && call.to)
        fullVisualization.push(getLabel('to'), getAddressVisualization(call.to))
    }

    return {
      ...call,
      fullVisualization: fullVisualization.length
        ? fullVisualization
        : call.to
          ? [getAction('Empty call to'), getAddressVisualization(call.to)]
          : [getAction('Empty call')]
    }
  })

  return newCalls
}
