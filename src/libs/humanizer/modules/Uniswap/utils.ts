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
  call.length >= 4 && call[0].content?.includes('Swap') && call[1].type === 'token'

export const uniReduce = (_calls: HumanizerVisualization[][]): HumanizerVisualization[] => {
  const calls = _calls
  for (let i = 0; i < calls.length; i++) {
    if (!calls[i]) continue
    if (!isSwap(calls[i])) continue

    const foundIndexOfWrapToRemove = calls.findIndex(
      (wrapCall) =>
        wrapCall &&
        wrapCall[0]?.content?.includes('Wrap') &&
        wrapCall[1]?.value === calls[i][1]?.value &&
        wrapCall[1].address === ZeroAddress
    )
    if (foundIndexOfWrapToRemove !== -1) {
      delete calls[foundIndexOfWrapToRemove]
      calls[i][1].address = ZeroAddress
    }

    const foundIndexOfUnwrapToRemove = calls.findIndex(
      (unwrapCall) =>
        unwrapCall &&
        unwrapCall[0]?.content?.includes('Unwrap') &&
        unwrapCall[1]?.value === calls[i][3]?.value &&
        unwrapCall[1].address === ZeroAddress
    )

    if (foundIndexOfUnwrapToRemove !== -1) {
      delete calls[foundIndexOfUnwrapToRemove]
      calls[i][3].address = ZeroAddress
    }

    // swaps with the same assets, not the current
    const similarSwaps = calls.filter(
      (c, j) =>
        j !== i &&
        isSwap(c) &&
        c[1].address === calls[i][1]?.address &&
        c[3].address === calls[i][3]?.address
    )

    similarSwaps.forEach((similarSwap) => {
      const indexOfSimilarSwapToRemove = calls.findIndex(
        (call) =>
          isSwap(call) &&
          call[1].address === similarSwap[1]?.address &&
          call[3].address === similarSwap[3]?.address &&
          call[1].value === similarSwap[1]?.value &&
          call[3].value === similarSwap[3]?.value
      )
      calls[i][1].value = calls[i][1].value! + calls[indexOfSimilarSwapToRemove][1].value!
      calls[i][3].value = calls[i][3].value! + calls[indexOfSimilarSwapToRemove][3].value!
      delete calls[indexOfSimilarSwapToRemove]
    })
  }
  const res = calls.filter((x) => x)
  return res.length === calls.length ? joinWithAndLabel(res) : uniReduce(res)
}
