import { BindedRelayerCall } from '@/libs/relayerCall/relayerCall'

import { RPCProvider } from '../../../interfaces/provider'
import { Call } from '../../accountOp/types'

export type SafeSingletonProvider = Pick<RPCProvider, 'getStorage'>

export type Erc7730RegistryOptions = {
  callRelayer?: BindedRelayerCall
  provider?: SafeSingletonProvider
}

export type Erc7730Primitive = string | number | boolean | null

export type Erc7730VisibleRule =
  | 'always'
  | 'never'
  | 'optional'
  | {
      ifNotIn?: Erc7730Primitive[]
      mustBe?: Erc7730Primitive[]
    }

export type Erc7730MapReference = {
  map: string
  keyPath: string
}

export type Erc7730Field = {
  path?: string
  value?: Erc7730Primitive
  visible?: Erc7730VisibleRule
  label?: string
  format?: string
  separator?: string
  params?: Record<string, unknown>
  fields?: Erc7730Field[]
  $ref?: string
}

export type Erc7730DisplayFormat = {
  $id?: string
  intent?: string
  interpolatedIntent?: string
  fields?: Erc7730Field[]
}

export type Erc7730Descriptor = {
  $schema?: string
  includes?: string | string[]
  context?: Record<string, unknown>
  metadata?: Record<string, unknown>
  display?: {
    definitions?: Record<string, Erc7730Field>
    formats?: Record<string, Erc7730DisplayFormat>
  }
}

export type Erc7730ResolvedDescriptor = {
  descriptor: Erc7730Descriptor
  path?: string
  safeTxCallDescriptor?: Erc7730ResolvedDescriptor
  safeTxCalls?: Call[]
  safeTxCallDescriptors?: Record<number, Erc7730ResolvedDescriptor>
  safeTxTransactionsOnly?: boolean
}

export type Erc7730CallDescriptors = Record<number, Erc7730ResolvedDescriptor>

export type Erc7730CalldataIndex = Record<string, string>

export type Erc7730Eip712IndexEntry = {
  path: string
  encodeTypeHashes?: string[]
}

export type Erc7730Eip712Index = Record<string, Record<string, Erc7730Eip712IndexEntry[]>>

export type Erc7730TypedDataTypes = Record<string, Array<{ name: string; type: string }>>

export type CacheEntry<T> = {
  value: T
  fetchedAt: number
}
