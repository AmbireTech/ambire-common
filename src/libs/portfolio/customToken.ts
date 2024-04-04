import { NetworkId } from '../../interfaces/networkDescriptor'

export interface CustomToken {
  address: string
  isHidden?: boolean
  name: string
  standard: string
  symbol: string
  decimals: number
  networkId: NetworkId
}
