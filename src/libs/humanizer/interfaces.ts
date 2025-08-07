import { Account } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'

// @TODO remove property humanizerMeta
export type HumanizerVisualization = (
  | {
      type:
        | 'address'
        | 'label'
        | 'action'
        | 'danger'
        | 'deadline'
        | 'chain'
        | 'image'
        | 'link'
        | 'text'
      url?: string
      address?: string
      content?: string
      value?: bigint
      warning?: boolean
      chainId?: bigint
    }
  | {
      type: 'token'
      address: string
      value: bigint
      chainId?: bigint
    }
) & { isHidden?: boolean; id: number; content?: string; isBold?: boolean }
export interface IrCall extends Omit<Call, 'to'> {
  fullVisualization?: HumanizerVisualization[]
  warnings?: HumanizerWarning[]
  to?: string
}
export interface IrMessage extends Message {
  fullVisualization?: HumanizerVisualization[]
  warnings?: HumanizerWarning[]
}
export interface HumanizerWarning {
  content: string
  level?: 'info' | 'warning' | 'danger'
}
export interface Ir {
  calls: IrCall[]
  messages: IrMessage[]
}

// @TODO make humanizer options interface
export interface HumanizerCallModule {
  (
    AccountOp: AccountOp,
    calls: IrCall[],
    humanizerMeta: HumanizerMeta,
    options?: HumanizerOptions
  ): IrCall[]
}

export interface HumanizerTypedMessageModule {
  (typedMessage: Message): Omit<IrMessage, keyof Message>
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

export interface HumanizerOptions {
  network?: Network
  chainId?: bigint
}

export type DataToHumanize = AccountOp | Message

export type KnownAddressLabels = { [key in Account['addr']]: string }
