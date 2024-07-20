import { Account } from '../../interfaces/account'
import { HumanizerFragment } from '../../interfaces/humanizer'
import { Network, NetworkId } from '../../interfaces/network'
import { Message, TypedMessage } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'

type HumanizerToken = {
  type: 'token'
  address: 'string'
  value: bigint
}

type HumanizerAddress = {
  type: 'address'
  address: string
}

type HumanizerChain = {
  type: 'chain'
  value: bigint
}

type HumanizerLabel = {
  type: 'label'
  content: string
}

type HumanizerAction = {
  type: 'action'
  content: string
}

type HumanizerDeadline = {
  type: 'deadline'
  value: bigint
}
type HumanizerMessage = {
  type: 'message'
  content: string
}

type HumanizerTypeEnum =
  | HumanizerToken
  | HumanizerAddress
  | HumanizerChain
  | HumanizerMessage
  | HumanizerLabel
  | HumanizerAction
  | HumanizerDeadline

export type HumanizerVisualization = {
  id: number
  isHidden?: boolean
} & HumanizerTypeEnum

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
  level?: 'caution' | 'alert' | 'alarm'
}
export interface Ir {
  calls: IrCall[]
  messages: IrMessage[]
}

export type HumanizerPromise = () => Promise<HumanizerFragment | null>
// @TODO make humanizer options interface
export interface HumanizerCallModule {
  (AccountOp: AccountOp, calls: IrCall[], humanizerMeta: HumanizerMeta, options?: any): [
    IrCall[],
    HumanizerPromise[]
  ]
}

export interface HumanizerTypedMessageModule {
  (typedMessage: TypedMessage): Omit<IrMessage, keyof Message>
}

export interface AbiFragment {
  selector: string
  type: 'error' | 'function' | 'event'
  signature: string
}

export interface HumanizerMetaAddress {
  name?: string
  // undefined means it is not a token
  token?: { symbol: string; decimals: number; networks?: string[] }
  // undefined means not a SC, {} means it is SC but we have no more info
  isSC?: { abiName?: string }
}

// more infor here https://github.com/AmbireTech/ambire-app/issues/1662
export interface HumanizerMeta {
  abis: {
    [name: string]: {
      [selector: string]: AbiFragment
    }
    NO_ABI: {
      [selector: string]: AbiFragment
    }
  }
  knownAddresses: {
    [address: string]: HumanizerMetaAddress
  }
}
export interface HumanizerSettings {
  humanizerMeta?: HumanizerMeta
  networkId: NetworkId
  accountAddr: string
}

export interface HumanizerParsingModule {
  (humanizerSettings: HumanizerSettings, visualization: HumanizerVisualization[], options?: any): [
    HumanizerVisualization[],
    HumanizerWarning[],
    HumanizerPromise[]
  ]
}
export interface HumanizerOptions {
  fetch?: Function
  emitError?: Function
  network?: Network
  networkId?: NetworkId
}

export type DataToHumanize = AccountOp | Message

export type KnownAddressLabels = { [key in Account['addr']]: string }
