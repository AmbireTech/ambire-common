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
  const hiddenTokens = humanizations.map((h) => h.filter(({ isHidden }) => isHidden)).flat()
  const humanizationsWithoutHiddenTokens = humanizations
    .map((h) => h.filter(({ isHidden }) => !isHidden))
    .filter((h) => h.length)
  const concatenatedVisibleHumanizations = humanizationsWithoutHiddenTokens
    .reduce((acc, arr) => [...acc, ...arr, getLabel('and')], [])
    .slice(0, -1)
  return [...concatenatedVisibleHumanizations, ...hiddenTokens]
}

const isSwap = (call: HumanizerVisualization[] | undefined) =>
  call &&
  call.length >= 4 &&
  call[0].content?.includes('Swap') &&
  call[1].type === 'token' &&
  call[3].type === 'token'

const isTake = (call: HumanizerVisualization[] | undefined) =>
  call && call.length === 2 && call[0].content?.includes('Take') && call[1].type === 'token'

const isWrap = (call: HumanizerVisualization[] | undefined) =>
  call && call.length >= 2 && call[0].content?.includes('Wrap') && call[1].type === 'token'

const isUnwrap = (call: HumanizerVisualization[] | undefined) =>
  call && call.length >= 2 && call[0].content?.includes('Unwrap') && call[1].type === 'token'

const isSend = (call: HumanizerVisualization[] | undefined) =>
  call && call.length >= 2 && call[0].content?.includes('Send') && call[1].type === 'token'

export const uniReduce = (_calls: HumanizerVisualization[][]): HumanizerVisualization[] => {
  const calls = _calls
  const originalCallsLength = calls.length
  for (let i = 0; i < calls.length; i++) {
    for (let j = 0; j < calls.length; j++) {
      // looks for wraps before the swap
      if (
        j < i &&
        calls[i] &&
        calls[j] &&
        isSwap(calls[i]) &&
        isWrap(calls[j]) &&
        calls[j][1].value === calls[i][1].value
      ) {
        calls[i][1].address = ZeroAddress
        calls.splice(j, 1)
      }
      // looks for unwrap after the swap
      if (
        i < j &&
        calls[i] &&
        calls[j] &&
        isSwap(calls[i]) &&
        isUnwrap(calls[j]) &&
        (calls[j][1].value === calls[i][3].value || calls[i][3].value === 0n)
      ) {
        calls[i][3].address = ZeroAddress
        calls.splice(j, 1)
      }

      // looks for swaps to merge
      if (
        i !== j &&
        calls[i] &&
        calls[j] &&
        isSwap(calls[i]) &&
        isSwap(calls[j]) &&
        calls[i][1].address === calls[j][1].address &&
        calls[i][3].address === calls[j][3].address
      ) {
        calls[i][1].value = calls[i][1].value! + calls[j][1].value!
        calls[i][3].value = calls[i][3].value! + calls[j][3].value!
        calls.splice(j, 1)
      }
      // looks for swaps to merge
      if (
        i !== j &&
        calls[i] &&
        calls[j] &&
        isSwap(calls[i]) &&
        isSwap(calls[j]) &&
        calls[i][3].address === calls[j][1].address
      ) {
        calls[i]?.push({ ...calls[i][3], isHidden: true })
        calls[i][3].value = calls[j][3].value!
        calls[i][3].address! = calls[j][3]?.address!

        calls.splice(j, 1)
      }

      // looks for fee payment to subtract
      if (
        i !== j &&
        calls[i] &&
        calls[j] &&
        isSend(calls[j]) &&
        isSwap(calls[i]) &&
        calls[i][3].value! / 400n >= calls[j][1].value!
      ) {
        calls[i][3].value = calls[i][3].value! - calls[j][1].value!
        calls.splice(j, 1)
      }

      if (
        i !== j &&
        calls[i] &&
        calls[j] &&
        isSend(calls[i]) &&
        isSwap(calls[j]) &&
        calls[i][1].address === calls[j][1].address
      ) {
        calls.splice(i, 1)
      }

      // looks for take (sweep) action to infer the swap minimum by
      if (
        i !== j &&
        calls[i] &&
        calls[j] &&
        isSwap(calls[i]) &&
        isTake(calls[j]) &&
        calls[i][3].address === calls[j][1].address
      ) {
        calls[i][3].value =
          calls[i][3].value! > calls[j][1].value! ? calls[i][3].value : calls[j][1].value
        calls.splice(j, 1)
      }
      if (
        i !== j &&
        calls[i] &&
        calls[j] &&
        isUnwrap(calls[i]) &&
        isTake(calls[j]) &&
        calls[i][1].address === calls[j][1].address
      ) {
        calls[i][1].value =
          calls[i][1].value! > calls[j][1].value! ? calls[i][1].value : calls[j][1].value
        calls.splice(j, 1)
      }
      // because of this https://www.codeslaw.app/contracts/ethereum/0x66a9893cc07d91d95644aedd05d03f95e1dba8af?file=src%2Fpkgs%2Funiversal-router%2Flib%2Fv4-periphery%2Fsrc%2Flibraries%2FActionConstants.sol&start=11&end=13
      // we can mash two swaps into one
      if (calls.filter(isSwap).length === 2) {
        const indexesOfSwaps = calls
          .map((call, index: number) => (isSwap(call) ? index : -1))
          .filter((index: number) => index !== -1)
        const indexOfFirstCall = indexesOfSwaps[0]
        const indexOfSecondCall = indexesOfSwaps[1]
        if (
          calls[indexOfFirstCall][3].value === 0n &&
          calls[indexOfSecondCall][1].value === BigInt(`0x8${'0'.repeat(63)}`) &&
          calls[indexOfFirstCall][3].address === calls[indexOfSecondCall][1].address
        ) {
          calls[indexOfFirstCall][3] = calls[indexOfSecondCall][3]
          calls.splice(indexOfSecondCall, 1)
        }
      }
    }
  }
  return originalCallsLength === calls.length ? joinWithAndLabel(calls) : uniReduce(calls)
}
