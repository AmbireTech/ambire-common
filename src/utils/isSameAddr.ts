import { getAddress } from 'ethers'

const isSameAddr = (one: string, two: string) => {
  return getAddress(one) === getAddress(two)
}

export default isSameAddr
