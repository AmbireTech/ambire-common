import { zeroAddress } from 'viem'

import { HumanizerVisualization } from '../../interfaces'
import { getRecipientText } from '../../utils'

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

// The text of the functions that add and remove liquidity. The swaps are not described with this:
// see `render.ts`.
export const getUniRecipientText = (accAddr: string, recAddr: string): HumanizerVisualization[] =>
  ['0x0000000000000000000000000000000000000001', zeroAddress].includes(recAddr)
    ? []
    : getRecipientText(accAddr, recAddr)
