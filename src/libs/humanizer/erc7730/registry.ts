import { isAddress } from 'ethers'

import { AccountOp } from '../../accountOp/accountOp'
import { Call } from '../../accountOp/types'
import { Message } from '../../../interfaces/userRequest'
import { getEip712EncodeTypeHash } from './eip712'
import {
  Erc7730CalldataIndex,
  Erc7730Descriptor,
  Erc7730Eip712Index,
  Erc7730Eip712IndexEntry,
  Erc7730Fetch,
  Erc7730ResolvedDescriptor,
  Erc7730TypedDataTypes
} from './types'

export const ERC7730_REGISTRY_BASE_URL =
  'https://raw.githubusercontent.com/ethereum/clear-signing-erc7730-registry/master/'

const ERC7730_CALLDATA_INDEX_URL = `${ERC7730_REGISTRY_BASE_URL}index.calldata.json`
const ERC7730_EIP712_INDEX_URL = `${ERC7730_REGISTRY_BASE_URL}index.eip712.json`

let calldataIndexPromise: Promise<Erc7730CalldataIndex> | null = null
let eip712IndexPromise: Promise<Erc7730Eip712Index> | null = null

const descriptorCache = new Map<string, Promise<Erc7730ResolvedDescriptor>>()

const resolveFetch = (fetcher?: Erc7730Fetch): Erc7730Fetch | null => {
  if (fetcher) return fetcher
  if (typeof globalThis.fetch !== 'function') return null

  return globalThis.fetch.bind(globalThis)
}

const fetchJson = async <T>(url: string, fetcher: Erc7730Fetch): Promise<T> => {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`Failed to fetch ERC-7730 resource: ${url}`)

  return response.json() as Promise<T>
}

const getResourceUrl = (pathOrUrl: string): string => {
  try {
    return new URL(pathOrUrl).href
  } catch {
    return new URL(pathOrUrl, ERC7730_REGISTRY_BASE_URL).href
  }
}

const getIncludeUrl = (includePath: string, parentUrl: string): string =>
  new URL(includePath, parentUrl).href

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const mergeDescriptors = (
  base: Erc7730Descriptor,
  override: Erc7730Descriptor
): Erc7730Descriptor => {
  const merge = (left: unknown, right: unknown): unknown => {
    if (isPlainObject(left) && isPlainObject(right)) {
      return Object.keys(right).reduce<Record<string, unknown>>(
        (acc, key) => ({
          ...acc,
          [key]: merge(acc[key], right[key])
        }),
        { ...left }
      )
    }

    return right === undefined ? left : right
  }

  return merge(base, override) as Erc7730Descriptor
}

const fetchDescriptor = async (
  pathOrUrl: string,
  fetcher: Erc7730Fetch,
  depth = 0
): Promise<Erc7730ResolvedDescriptor> => {
  const url = getResourceUrl(pathOrUrl)
  const cached = descriptorCache.get(url)
  if (cached) return cached

  const descriptorPromise = (async () => {
    const descriptor = await fetchJson<Erc7730Descriptor>(url, fetcher)
    const includes = descriptor.includes
      ? Array.isArray(descriptor.includes)
        ? descriptor.includes
        : [descriptor.includes]
      : []

    if (!includes.length || depth >= 5) return { descriptor, path: pathOrUrl }

    const includedDescriptors = await Promise.all(
      includes.map((includePath) =>
        fetchDescriptor(getIncludeUrl(includePath, url), fetcher, depth + 1)
      )
    )

    const mergedIncludes = includedDescriptors.reduce<Erc7730Descriptor>(
      (merged, included) => mergeDescriptors(merged, included.descriptor),
      {}
    )

    return {
      descriptor: mergeDescriptors(mergedIncludes, descriptor),
      path: pathOrUrl
    }
  })()

  descriptorCache.set(url, descriptorPromise)

  try {
    return await descriptorPromise
  } catch (error) {
    descriptorCache.delete(url)
    throw error
  }
}

const getCalldataIndex = async (fetcher: Erc7730Fetch): Promise<Erc7730CalldataIndex> => {
  if (!calldataIndexPromise) {
    calldataIndexPromise = fetchJson<Erc7730CalldataIndex>(
      ERC7730_CALLDATA_INDEX_URL,
      fetcher
    ).catch((error) => {
      calldataIndexPromise = null
      throw error
    })
  }

  return calldataIndexPromise
}

const getEip712Index = async (fetcher: Erc7730Fetch): Promise<Erc7730Eip712Index> => {
  if (!eip712IndexPromise) {
    eip712IndexPromise = fetchJson<Erc7730Eip712Index>(ERC7730_EIP712_INDEX_URL, fetcher).catch(
      (error) => {
        eip712IndexPromise = null
        throw error
      }
    )
  }

  return eip712IndexPromise
}

const getRegistryKey = (chainId: bigint | number | string, address: string): string =>
  `eip155:${BigInt(chainId).toString()}:${address.toLowerCase()}`

const getTypedMessageChainId = (message: Message): bigint | null => {
  if (message.content.kind !== 'typedMessage') return null

  try {
    return BigInt((message.content.domain.chainId ?? message.chainId) as string | number | bigint)
  } catch {
    return null
  }
}

const selectEip712IndexEntry = (
  entries: Erc7730Eip712IndexEntry[],
  types: Erc7730TypedDataTypes,
  primaryType: string
): Erc7730Eip712IndexEntry | null => {
  let encodeTypeHash: string | null = null

  try {
    encodeTypeHash = getEip712EncodeTypeHash(types, primaryType)
  } catch {
    return entries.length === 1 ? entries[0]! : null
  }

  return (
    entries.find(
      (entry) =>
        !entry.encodeTypeHashes?.length ||
        entry.encodeTypeHashes.some((hash) => hash.toLowerCase() === encodeTypeHash)
    ) || null
  )
}

export const fetchErc7730DescriptorForCall = async (
  call: Call,
  chainId: AccountOp['chainId'],
  fetcher?: Erc7730Fetch
): Promise<Erc7730ResolvedDescriptor | null> => {
  const resolvedFetch = resolveFetch(fetcher)
  if (!resolvedFetch || !call.to || !isAddress(call.to)) return null

  try {
    const index = await getCalldataIndex(resolvedFetch)
    const descriptorPath = index[getRegistryKey(chainId, call.to)]
    if (!descriptorPath) return null

    return fetchDescriptor(descriptorPath, resolvedFetch)
  } catch (error) {
    console.error(error)
    return null
  }
}

export const fetchErc7730DescriptorsForAccountOp = async (
  accountOp: AccountOp,
  fetcher?: Erc7730Fetch
): Promise<Record<number, Erc7730ResolvedDescriptor>> => {
  const resolvedDescriptors = await Promise.all(
    accountOp.calls.map(async (call, index) => {
      const descriptor = await fetchErc7730DescriptorForCall(call, accountOp.chainId, fetcher)
      return descriptor ? ([index, descriptor] as const) : null
    })
  )

  return resolvedDescriptors.reduce<Record<number, Erc7730ResolvedDescriptor>>((acc, entry) => {
    if (!entry) return acc

    acc[entry[0]] = entry[1]
    return acc
  }, {})
}

export const fetchErc7730DescriptorForMessage = async (
  message: Message,
  fetcher?: Erc7730Fetch
): Promise<Erc7730ResolvedDescriptor | null> => {
  const resolvedFetch = resolveFetch(fetcher)
  if (!resolvedFetch || message.content.kind !== 'typedMessage') return null

  const verifyingContract = message.content.domain.verifyingContract
  const chainId = getTypedMessageChainId(message)
  if (!verifyingContract || !chainId || !isAddress(verifyingContract)) return null

  try {
    const index = await getEip712Index(resolvedFetch)
    const primaryType = String(message.content.primaryType)
    const entries = index[getRegistryKey(chainId, verifyingContract)]?.[primaryType]
    if (!entries?.length) return null

    const entry = selectEip712IndexEntry(
      entries,
      message.content.types as Erc7730TypedDataTypes,
      primaryType
    )
    if (!entry) return null

    return fetchDescriptor(entry.path, resolvedFetch)
  } catch (error) {
    console.error(error)
    return null
  }
}
