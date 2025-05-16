import { Hex } from '../../interfaces/hex'

export interface ChainDelegation {
  [chainId: string]: { has: boolean; delegatedContract: Hex }
}

export interface AccountDelegation {
  [accAddr: string]: { [chainId: string]: { has: boolean; delegatedContract: Hex } } | null
}
