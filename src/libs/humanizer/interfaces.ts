import { Account } from '../../interfaces/account'
import { BlacklistedStatus } from '../../interfaces/phishing'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'

export interface HumanizerErc7730Row {
  label: string
  value: HumanizerVisualization[]
}

export interface HumanizerErc7730Visualization {
  type: 'erc7730'
  title?: string
  dapp?: Call['dapp']
  rows: HumanizerErc7730Row[]
}

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
        | 'break'
      url?: string
      address?: string
      content?: string
      value?: bigint
      warning?: boolean
      chainId?: bigint
    }
  | HumanizerErc7730Visualization
  | {
      type: 'token'
      address: string
      value: bigint
      chainId?: bigint
    }
) & {
  id: number
  url?: string
  address?: string
  content?: string
  value?: bigint
  isBold?: boolean
  warning?: boolean
  chainId?: bigint
  verification?: BlacklistedStatus
}
export interface IrCall extends Omit<Call, 'to'> {
  fullVisualization?: HumanizerVisualization[]
  warnings?: HumanizerWarning[]
  isFallback?: boolean
  to?: string
}
export interface IrMessage extends Message {
  fullVisualization?: HumanizerVisualization[]
  warnings?: HumanizerWarning[]
  canHideDropdownArrow?: boolean
}
export interface HumanizerWarning {
  content: string
  blocking?: boolean
  code: string
}
export interface Ir {
  calls: IrCall[]
  messages: IrMessage[]
}

// @TODO make humanizer options interface
export interface HumanizerCallModule {
  (AccountOp: AccountOp, calls: IrCall[], humanizerMeta?: HumanizerMeta): IrCall[]
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
  logo?: string
  name?: string
  // undefined means it is not a token
  token?: { symbol: string; decimals?: number }
  // undefined means not a SC, {} means it is SC but we have no more info
  isSC?: boolean
  chainIds?: number[]
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

export type DataToHumanize = AccountOp | Message

export type KnownAddressLabels = { [key in Account['addr']]: string }
