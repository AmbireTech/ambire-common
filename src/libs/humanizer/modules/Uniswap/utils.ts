import { ZeroAddress } from 'ethers'

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

export const getUniRecipientText = (accAddr: string, recAddr: string): HumanizerVisualization[] =>
  recAddr === ZeroAddress ? [] : getRecipientText(accAddr, recAddr)
