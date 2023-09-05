import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'

export type HumanizerVisualization = {
  type: 'token' | 'address' | 'label' | 'action' | 'nft' | 'danger'
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
export interface IrMessage extends Message {
  fullVisualization?: HumanizerVisualization[]
}

export interface Ir {
  calls: IrCall[]
  messages: IrMessage[]
}

export interface HumanizerFragment {
  key: string
  isGlobal: boolean
  value: string | Array<any> | object
}

export interface HumanizerCallModule {
  (accountOp: AccountOp, calls: IrCall[], options?: any): [
    IrCall[],
    Promise<HumanizerFragment | null>[]
  ]
}
