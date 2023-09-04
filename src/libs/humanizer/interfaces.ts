import { AccountOp } from 'libs/accountOp/accountOp'

export type HumanizerVisualization = {
  type: 'token' | 'address' | 'label' | 'action' | 'nft'
  address?: string
  content?: string
  amount?: bigint
  decimals?: number
  readableAmount?: string
  symbol?: string
  name?: string
  id?: bigint
}
export interface IrCall {
  data: string
  to: string
  value: bigint
  fullVisualization?: HumanizerVisualization[]
}

export interface Ir {
  calls: IrCall[]
}

export interface HumanizerFragment {
  key: string
  isGlobal: boolean
  value: string | Array<any> | object
}

export interface HumanizerModule {
  (accountOp: AccountOp, ir: Ir, options?: any): [Ir, Promise<HumanizerFragment | null>[]]
}
