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
  // The format's plain, non-interpolated short title (e.g. "Swap") per the
  // ERC-7730 spec's `intent`. It never needs a token/decimals lookup, so it's
  // always safe to use as-is - this is the string other logic reads (label
  // comparisons, heuristics, non-rich surfaces) and the fallback text when
  // `titleParts` is absent. Prefer `titleParts` for display when present.
  title?: string
  // The interpolated title (per the format's `interpolatedIntent`), split into
  // renderable parts (text/token/address/...) so the UI can render a token
  // amount with the same live decimals/symbol/price lookup used for row values
  // (e.g. via a `type: 'token'` item), instead of requiring decimals to be
  // statically known at humanization time. Present only when the format used
  // `interpolatedIntent` AND every placeholder resolved successfully - per the
  // spec, a failed interpolation falls back entirely to `title` above rather
  // than leaking a raw/unformatted value into the UI.
  titleParts?: HumanizerVisualization[]
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
  mlMi?: boolean
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
  address?: string
}
export interface Ir {
  calls: IrCall[]
  messages: IrMessage[]
}

// @TODO make humanizer options interface
export interface HumanizerCallModule {
  (accountOp: AccountOp, call: IrCall, humanizerMeta?: HumanizerMeta): IrCall
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
