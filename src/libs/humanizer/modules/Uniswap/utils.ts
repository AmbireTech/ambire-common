/* eslint-disable no-continue */
import { ZeroAddress } from 'ethers'

import { HumanizerVisualization } from '../../interfaces'
import { getLabel, getRecipientText } from '../../utils'

export function parsePath(pathBytes: any) {
  // some decodePacked fun
  // can we do this with Ethers AbiCoder? probably not
  const path = []
  // address, uint24
  for (let i = 2; i < pathBytes.length; i += 46) {
    path.push(`0x${pathBytes.substr(i, 40)}`)
  }
  return path
}

export const getUniRecipientText = (accAddr: string, recAddr: string): HumanizerVisualization[] =>
  ['0x0000000000000000000000000000000000000001', ZeroAddress].includes(recAddr)
    ? []
    : getRecipientText(accAddr, recAddr)

export const joinWithAndLabel = (
  humanizations: HumanizerVisualization[][]
): HumanizerVisualization[] => {
  return humanizations.reduce((acc, arr) => [...acc, ...arr, getLabel('and')], []).slice(0, -1)
}

const isSwap = (call: HumanizerVisualization[]) =>
  call.length >= 4 &&
  call[0].content?.includes('Swap') &&
  call[1].type === 'token' &&
  call[3].type === 'token'

export const uniReduce = (_calls: HumanizerVisualization[][]): HumanizerVisualization[] => {
  const calls: (HumanizerVisualization[] | undefined)[] = _calls
  for (let i = 0; i < calls.length; i++) {
    if (!calls[i]) continue
    if (!isSwap(calls[i]!)) continue
    let doneFlag = false
    // looks for wraps before the swap
    for (let j = 0; j < i; j++) {
      if (
        calls[i] &&
        calls[j] &&
        calls[j]!.length >= 2 &&
        calls[j]![0].content?.includes('Wrap') &&
        calls[j]![1].value === calls[i]![1].value
      ) {
        calls[i]![1].address = ZeroAddress
        delete calls[j]
        doneFlag = true
        break
      }
    }
    if (doneFlag) continue

    for (let j = i + 1; j < calls.length; j++) {
      if (
        calls[i] &&
        calls[j] &&
        calls[i]!.length >= 4 &&
        calls[j]!.length >= 2 &&
        calls[j]![0].content?.includes('Unwrap') &&
        calls[j]![1].value === calls[i]![3].value
      ) {
        calls[i]![3].address = ZeroAddress
        delete calls[j]
        doneFlag = true
        break
      }
    }
    if (doneFlag) continue
    for (let j = 0; j < calls.length; j++) {
      if (
        i !== j &&
        calls[i] &&
        calls[j] &&
        isSwap(calls[i]!) &&
        isSwap(calls[j]!) &&
        calls[i]![1].address === calls[j]![1].address &&
        calls[i]![3].address === calls[j]![3].address
      ) {
        calls[i]![1].value = calls[i]![1].value! + calls[j]![1].value!
        calls[i]![3].value = calls[i]![3].value! + calls[j]![3].value!
        delete calls[j]
      }
    }
  }
  const res = calls.filter((x) => x) as HumanizerVisualization[][]
  return res.length === calls.length ? joinWithAndLabel(res) : uniReduce(res)
}
