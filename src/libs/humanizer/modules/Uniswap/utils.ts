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

const isSwap = (call: HumanizerVisualization[] | undefined) =>
  call &&
  call.length >= 4 &&
  call[0].content?.includes('Swap') &&
  call[1].type === 'token' &&
  call[3].type === 'token'

const isTake = (call: HumanizerVisualization[] | undefined) =>
  call &&
  call.length === 3 &&
  call[0].content?.includes('Take') &&
  call[1].content === 'at least' &&
  call[2].type === 'token'

const isWrap = (call: HumanizerVisualization[] | undefined) =>
  call && call.length >= 2 && call[0].content?.includes('Wrap') && call[1].type === 'token'

const isUnwrap = (call: HumanizerVisualization[] | undefined) =>
  call && call.length >= 2 && call[0].content?.includes('Unwrap') && call[1].type === 'token'

const isSend = (call: HumanizerVisualization[] | undefined) =>
  call &&
  call.length >= 4 &&
  call[0].content?.includes('Send') &&
  call[1].type === 'token' &&
  call[2]?.content?.includes('to') &&
  call[3].type === 'address'
export const uniReduce = (_calls: HumanizerVisualization[][]): HumanizerVisualization[] => {
  const calls: (HumanizerVisualization[] | undefined)[] = _calls
  for (let i = 0; i < calls.length; i++) {
    let doneFlag = false
    // looks for wraps before the swap
    for (let j = 0; j < i; j++) {
      if (isSwap(calls[i]) && isWrap(calls[j]) && calls[j]![1].value === calls[i]![1].value) {
        calls[i]![1].address = ZeroAddress
        delete calls[j]
        doneFlag = true
        break
      }
    }
    if (doneFlag) continue

    for (let j = i + 1; j < calls.length; j++) {
      if (isSwap(calls[i]) && isUnwrap(calls[j]) && calls[j]![1].value === calls[i]![3].value) {
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
        isSwap(calls[i]!) &&
        isSwap(calls[j]!) &&
        calls[i]![1].address === calls[j]![1].address &&
        calls[i]![3].address === calls[j]![3].address
      ) {
        calls[i]![1].value = calls[i]![1].value! + calls[j]![1].value!
        calls[i]![3].value = calls[i]![3].value! + calls[j]![3].value!
        delete calls[j]
      }

      if (
        isSend(calls[j]) &&
        isSwap(calls[i]!) &&
        calls[i]![3].value! / 400n >= calls[j]![1].value!
      ) {
        calls[i]![3].value = calls[i]![3].value! - calls[j]![1].value!
        delete calls[j]
      }
    }

    if (doneFlag) continue
    for (let j = 0; j < calls.length; j++) {
      if (
        i !== j &&
        isSwap(calls[i]!) &&
        isTake(calls[j]!) &&
        calls[i]![3].address === calls[j]![2].address
      ) {
        calls[i]![3].value = calls[j]![2].value!
        delete calls[j]
      }

      if (
        isSend(calls[j]) &&
        isSwap(calls[i]!) &&
        calls[i]![3].value! / 400n >= calls[j]![1].value!
      ) {
        calls[i]![3].value = calls[i]![3].value! - calls[j]![1].value!
        delete calls[j]
      }
    }
  }
  const res = calls.filter((x) => x) as HumanizerVisualization[][]
  return res.length === calls.length ? joinWithAndLabel(res) : uniReduce(res)
}
