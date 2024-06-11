import { NetworkId } from '../../interfaces/networkDescriptor'

export interface CustomToken {
  address: string
  isHidden?: boolean
  standard: string
  symbol: string
  decimals: number
  networkId: NetworkId
}
