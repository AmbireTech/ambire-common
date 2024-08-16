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

/**
 * @example
 * // supposed to work like, but join returns a string
 * input.join(getLabel('and'))
 */
export const joinWithAndLabel = (
  humanizations: HumanizerVisualization[][]
): HumanizerVisualization[] => {
  return humanizations.reduce((acc, arr) => [...acc, ...arr, getLabel('and')], []).slice(0, -1)
}

export const uniReduce = (calls: HumanizerVisualization[][]): HumanizerVisualization[] => {
  const reduced: HumanizerVisualization[][] = []
  for (let i = 0; i < calls.length; i++) {
    if (i === calls.length - 1) {
      reduced.push(calls[i])
      // eslint-disable-next-line no-continue
      continue
    }

    const current = calls[i]
    const next = calls[i + 1]
    if (
      current.length >= 4 &&
      next.length === 2 &&
      current[0].content?.includes('Swap') &&
      next[0].content?.includes('Unwrap') &&
      current[3].type === 'token' &&
      next[1].type === 'token' &&
      current[3].value === next[1].value &&
      next[1].address === ZeroAddress
    ) {
      current[3].address = ZeroAddress
      reduced.push(current)
      i++
    } else if (
      current.length === 2 &&
      next.length >= 4 &&
      current[0].content?.includes('Wrap') &&
      next[0].content?.includes('Swap') &&
      current[1].type === 'token' &&
      next[1].type === 'token' &&
      current[1].value === next[1].value
    ) {
      next[1].address = ZeroAddress
      reduced.push(next)
      i++
    } else if (
      current.length >= 4 &&
      next.length >= 4 &&
      current[0].content?.includes('Swap') &&
      next[0].content?.includes('Swap') &&
      [current[1], current[3], next[1], next[3]].every((t) => t.type === 'token') &&
      current[1].address === next[1].address &&
      current[3].address === next[3].address
    ) {
      current[1].value! += next[1].value!
      current[3].value! += next[3].value!
      reduced.push(current)
      i++
    } else {
      reduced.push(current)
    }
  }
  return calls.length === reduced.length ? joinWithAndLabel(calls) : uniReduce(reduced)
}
