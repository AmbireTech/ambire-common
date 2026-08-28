import { RPCProvider } from '../../../interfaces/provider'
import { Call } from '../../accountOp/types'

export type SafeSingletonProvider = Pick<RPCProvider, 'getStorage'>

/**
 * A resource the library found it needs but does not have yet. The library never fetches: it
 * reports wants, the controller answers them, and the library is asked again with more `known`.
 */
export type Erc7730Want =
  /** The descriptor registered for a contract - the controller does the index lookup. */
  | { kind: 'contractDescriptor'; chainId: bigint; address: string }
  /** A descriptor referenced by another descriptor's `includes`. */
  | { kind: 'includedDescriptor'; path: string }
  /** The descriptor for a typed message, chosen by primary type and encode-type hash. */
  | {
      kind: 'eip712Descriptor'
      chainId: bigint
      verifyingContract: string
      primaryType: string
      encodeTypeHash: string | null
    }
  /** The implementation a Safe proxy delegates to, read over RPC. */
  | { kind: 'safeSingleton'; chainId: bigint; address: string }

/**
 * Everything the library has been given so far.
 *
 * A `null` value means "asked for, and there is none" - as opposed to a missing key, which means
 * "not asked yet". Recording those negatives is what stops the planning loop asking for the same
 * absent resource forever.
 */
export type Erc7730Known = {
  /** `eip155:{chainId}:{address}` -> the path its descriptor lives at, or null if unregistered. */
  contractDescriptors: Record<string, { path: string } | null>
  /** `eip155:{chainId}:{verifyingContract}:{primaryType}` -> path, or null if unregistered. */
  eip712Descriptors: Record<string, { path: string } | null>
  /** Raw descriptors by path, before their `includes` are merged in; null if it can't be had. */
  descriptorsByPath: Record<string, Erc7730Descriptor | null>
  /** `{chainId}:{address}` -> the singleton behind a proxy, or null if it isn't one. */
  safeSingletons: Record<string, string | null>
}

export const EMPTY_ERC7730_KNOWN: Erc7730Known = {
  contractDescriptors: {},
  eip712Descriptors: {},
  descriptorsByPath: {},
  safeSingletons: {}
}

/**
 * One traversal, two views. Walking a call decides what it can from `known` and records what it
 * still needs - so planning and resolving are the same code and cannot disagree about what a call
 * requires.
 */
export type Erc7730Resolution = {
  descriptor: Erc7730ResolvedDescriptor | null
  wants: Erc7730Want[]
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

// Shape persisted under the `erc7730RegistryCache` storage key - mirrors the in-memory caches in
// registry.ts (calldata index, EIP-712 index, resolved descriptors keyed by descriptor path), so
// descriptors fetched once from the relayer survive reloads and are reusable without a network call.
export type Erc7730PersistedRegistryCache = {
  calldataIndex: CacheEntry<Erc7730CalldataIndex> | null
  eip712Index: CacheEntry<Erc7730Eip712Index> | null
  descriptors: Record<string, CacheEntry<Erc7730Descriptor>>
}
