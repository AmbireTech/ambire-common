import { Hex } from '../../interfaces/hex'

export interface ChainDelegation {
  [chainId: string]: {
    has: boolean
    delegatedContract: Hex
    isAmbire?: boolean
    isMetamask?: boolean
    isUnknown?: boolean
  }
}

export interface AccountDelegation {
  [accAddr: string]: ChainDelegation | null
}
