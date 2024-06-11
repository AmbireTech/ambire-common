import { NetworkId } from '../../interfaces/network'

export interface CustomToken {
  address: string
  isHidden?: boolean
  name: string
  standard: string
  symbol: string
  decimals: number
  networkId: NetworkId
}
