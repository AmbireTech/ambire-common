import { NetworkId } from 'interfaces/networkDescriptor'

import { Account } from '../../interfaces/account'
import { Message, TypedMessage } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'

// @TODO properties to be removed - decimals,readableAmount?symbol, name
// @TODO add properties humanizerMeta
export type HumanizerVisualization = {
  type: 'token' | 'address' | 'label' | 'action' | 'nft' | 'danger' | 'deadline'
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
  level?: 'caution' | 'alert' | 'alarm'
}
export interface Ir {
  calls: IrCall[]
  messages: IrMessage[]
}

export interface HumanizerFragment {
  type: 'knownAddresses' | 'abis' | 'selector' | 'token'
  isGlobal: boolean
  key: string
  value: string | Array<any> | AbiFragment | any
}

export interface HumanizerCallModule {
  (AccountOp: AccountOp, calls: IrCall[], options?: any): [
    IrCall[],
    Promise<HumanizerFragment | null>[]
  ]
}

export interface HumanizerTypedMessaageModule {
  (typedMessage: TypedMessage): Omit<IrMessage, keyof Message>
}

export interface AbiFragment {
  selector: string
  type: 'error' | 'function' | 'event'
  signature: string
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
    [address: string]: {
      name?: string
      // undefined means it is not a token
      token?: { symbol: string; decimals: number; networks?: string[] }
      // undefined means not a SC, {} means it is SC but we have no more info
      isSC?: { isAA?: boolean; abiName?: string }
    }
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
    Promise<HumanizerFragment | null>[]
  ]
}

export type DataToHumanize = AccountOp | Message

export type KnownAddressLabels = { [key in Account['addr']]: string }
