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
