/* eslint-disable no-continue */
import { zeroAddress } from 'viem'

import { networks } from '../../../../consts/networks'
import { HumanizerVisualization } from '../../interfaces'
import { getLabel, getRecipientText } from '../../utils'

const WRAPPED_NATIVE_TOKEN_ADDRESSES = new Set(
  networks.map((network) => network.wrappedAddr?.toLowerCase()).filter(Boolean)
)
const UNISWAP_FEE_RECIPIENT_ADDRESSES = new Set(['0x000000fee13a103a10d593b9ae06b3e05f2e7e1c'])

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
  ['0x0000000000000000000000000000000000000001', zeroAddress].includes(recAddr)
    ? []
    : getRecipientText(accAddr, recAddr)

export const joinWithAndLabel = (
  humanizations: HumanizerVisualization[][]
): HumanizerVisualization[] =>
  humanizations
    .filter((h) => h.length)
    .reduce((acc, arr) => [...acc, ...arr, getLabel('and')], [])
    .slice(0, -1)

const isSwap = (
  call: HumanizerVisualization[] | undefined
): call is [
  HumanizerVisualization,
  HumanizerVisualization,
  HumanizerVisualization,
  HumanizerVisualization
] =>
  !!call &&
  call.length >= 4 &&
  !!call[1]?.type &&
  !!call[3]?.type &&
  !!call[0]?.content &&
  call[0].content.includes('Swap') &&
  call[1].type === 'token' &&
  call[3].type === 'token'

const isTake = (
  call: HumanizerVisualization[] | undefined
): call is [HumanizerVisualization, HumanizerVisualization] =>
  !!call &&
  call.length === 2 &&
  !!call[0] &&
  !!call[1] &&
  !!call[0].content &&
  call[0].content.includes('Take') &&
  call[1].type === 'token'

const isWrap = (
  call: HumanizerVisualization[] | undefined
): call is [HumanizerVisualization, HumanizerVisualization] =>
  !!call &&
  call.length >= 2 &&
  !!call[0]?.content &&
  !!call[1]?.type &&
  call[0].content.includes('Wrap') &&
  call[1].type === 'token'

const isUnwrap = (
  call: HumanizerVisualization[] | undefined
): call is [HumanizerVisualization, HumanizerVisualization] =>
  !!call &&
  call.length >= 2 &&
  !!call[0]?.content &&
  !!call[1]?.type &&
  call[0].content.includes('Unwrap') &&
  call[1].type === 'token'

const isSend = (
  call: HumanizerVisualization[] | undefined
): call is [HumanizerVisualization, HumanizerVisualization] =>
  !!call &&
  call.length >= 2 &&
  !!call[0]?.content &&
  !!call[1]?.type &&
  call[0].content?.includes('Send') &&
  call[1].type === 'token'

const getDeadlineValue = (call: HumanizerVisualization[]) => {
  const deadline = call.find((item) => item.type === 'deadline')
  return deadline?.value
}

const getSendRecipient = (call: HumanizerVisualization[]) => {
  const recipient = call.find((item) => item.type === 'address')
  return recipient?.address?.toLowerCase()
}

export const uniReduce = (_calls: HumanizerVisualization[][]): HumanizerVisualization[] => {
  const calls = _calls
  const originalCallsLength = calls.length
  for (let i = 0; i < calls.length; i++) {
    for (let j = 0; j < calls.length; j++) {
      // looks for wraps before the swap
      const callI = calls[i]
      const callJ = calls[j]
      if (
        j < i &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isWrap(callJ) &&
        WRAPPED_NATIVE_TOKEN_ADDRESSES.has(callI[1].address?.toLowerCase()) &&
        (callJ[1].value === callI[1].value || callI[1].value === 0n)
      ) {
        callI[1].address = zeroAddress
        calls.splice(j, 1)
      }
      // looks for unwrap after the swap
      if (
        i < j &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isUnwrap(callJ) &&
        (callJ[1].value === callI[3].value || callI[3].value === 0n)
      ) {
        callI[3].address = zeroAddress
        if (callI[3].value === 0n && callJ[1].value) callI[3].value = callJ[1].value
        calls.splice(j, 1)
      }

      // looks for swaps to merge
      if (
        i !== j &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isSwap(callJ) &&
        callI[1].address === callJ[1].address &&
        callI[3].address === callJ[3].address
      ) {
        callI[1].value = callI[1].value! + callJ[1].value!
        callI[3].value = callI[3].value! + callJ[3].value!
        calls.splice(j, 1)
      }
      // looks for swaps to merge
      if (
        i !== j &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isSwap(callJ) &&
        callI[3].address === callJ[3].address &&
        getDeadlineValue(callI) === getDeadlineValue(callJ) &&
        ((callI[1].address === zeroAddress &&
          WRAPPED_NATIVE_TOKEN_ADDRESSES.has(callJ[1].address?.toLowerCase())) ||
          (callJ[1].address === zeroAddress &&
            WRAPPED_NATIVE_TOKEN_ADDRESSES.has(callI[1].address?.toLowerCase())))
      ) {
        if (callI[1].address !== zeroAddress) {
          callI[1].address = zeroAddress
        }
        calls.splice(j, 1)
      }
      // looks for swaps to merge
      if (
        i !== j &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isSwap(callJ) &&
        callI[3].address === callJ[1].address
      ) {
        callI[3].value = callJ[3].value!
        callI[3].address = callJ[3].address

        calls.splice(j, 1)
      }

      // looks for fee payment to subtract
      if (
        i !== j &&
        callI &&
        callJ &&
        isSend(callJ) &&
        isSwap(callI) &&
        callJ[1].address === callI[3].address &&
        UNISWAP_FEE_RECIPIENT_ADDRESSES.has(getSendRecipient(callJ) || '')
      ) {
        calls.splice(j, 1)
      }

      if (callI && isSend(callI) && callI[1].value === 0n) {
        calls.splice(i, 1)
      }

      if (
        i !== j &&
        callI &&
        callJ &&
        isSend(callI) &&
        isSwap(callJ) &&
        callI[1].address === callJ[1].address
      ) {
        calls.splice(i, 1)
      }

      // looks for take (sweep) action to infer the swap minimum by
      if (
        i !== j &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isTake(callJ) &&
        callI[3].address === callJ[1].address
      ) {
        calls.splice(j, 1)
      }
      if (
        i !== j &&
        callI &&
        callJ &&
        isUnwrap(callI) &&
        isTake(callJ) &&
        callI[1].address === callJ[1].address
      ) {
        if (callI[1].value && callI[1].value > 0n) {
          callI[1].value = callI[1].value > callJ[1].value! ? callI[1].value : callJ[1].value
        }
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
        if (typeof indexOfFirstCall === 'number' && typeof indexOfSecondCall === 'number') {
          const firstCall = calls[indexOfFirstCall]
          const secondCall = calls[indexOfSecondCall]
          if (
            firstCall &&
            secondCall &&
            firstCall[3] &&
            secondCall[1] &&
            secondCall[3] &&
            firstCall[3].value === 0n &&
            secondCall[1].value === BigInt(`0x8${'0'.repeat(63)}`) &&
            firstCall[3].address === secondCall[1].address
          ) {
            firstCall[3] = secondCall[3]
            calls.splice(indexOfSecondCall, 1)
          }
        }
      }
    }
  }
  return originalCallsLength === calls.length ? joinWithAndLabel(calls) : uniReduce(calls)
}
