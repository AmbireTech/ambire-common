import { Account } from '../../interfaces/account'
import { BlacklistedStatus } from '../../interfaces/phishing'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'

export type HumanizerErc7730Row = {
  // The ERC-7730 field path this row was built from - used to match against `excludedFieldPaths`.
  // Absent for rows synthesized outside real ERC-7730 fields (fallback/multicall/Safe rows), which
  // are never candidates for exclusion anyway.
  path?: string
} & (
  | {
      // One embedded call of a `calldata` field, rendered inline on a single line and never split
      // into rows of its own. Holds the nested `erc7730` visualization when that call had a
      // descriptor, or the flat parts the legacy humanizer modules produced when it had none - so
      // a module's own wording (e.g. "Swap X for Y") survives instead of being taken apart. Carries
      // no label: the parts are the whole row.
      type: 'call'
      value: HumanizerVisualization[]
    }
  | {
      // Any other field: its label and the single value the ERC-7730 formatter produced for it.
      type: 'single-value'
      label: string
      value: HumanizerVisualization
    }
)

export interface HumanizerErc7730Visualization {
  type: 'erc7730'
  // The rendered intent, as parts (text/token/address/action/...). `[action]`
  // (from the spec's plain `intent`) when there's no `interpolatedIntent` or it
  // failed to resolve; the full structured breakdown otherwise.
  intent: HumanizerVisualization[]
  // Paths of fields already rendered inline in `intent` (empty for the plain
  // `[action]` form). Rows to display = `fields` filtered to exclude these -
  // recomputed from `fields` rather than stored as a second row array, so a
  // nested visualization tree doesn't double its own payload at every level.
  excludedFieldPaths: string[]
  // Every field turned into a row, regardless of what's excluded above - for
  // heuristics (spender/recipient detection, swap pairing, layout complexity)
  // that need full context independent of `intent`.
  fields: HumanizerErc7730Row[]
  dapp?: Call['dapp']
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
