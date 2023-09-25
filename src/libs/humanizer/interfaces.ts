import { Message, TypedMessage } from '../../interfaces/userRequest'
import { AccountOp, Call } from '../accountOp/accountOp'

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
export interface IrCall extends Call {
  fullVisualization?: HumanizerVisualization[]
  warnings?: HumanizerWarning[]
}
export interface IrMessage extends Message {
  fullVisualization?: HumanizerVisualization[]
  warnings?: HumanizerWarning[]
}
export interface HumanizerWarning {
  content: string
  level?: string
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
  (dataToHumanize: DataToHumanize, calls: IrCall[], options?: any): [
    IrCall[],
    Promise<HumanizerFragment | null>[]
  ]
}

export interface HumanizerTypedMessaageModule {
  (typedMessage: TypedMessage): HumanizerVisualization[]
}

export interface HumanizerParsingModule {
  (dataToHumanize: DataToHumanize, visualization: HumanizerVisualization[], options?: any): [
    HumanizerVisualization[],
    HumanizerWarning[],
    Promise<HumanizerFragment | null>[]
  ]
}

export type DataToHumanize = AccountOp | Message
