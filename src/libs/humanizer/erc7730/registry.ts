import { isAddress } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { AccountOp } from '../../accountOp/accountOp'
import { Call } from '../../accountOp/types'
import { getEip712EncodeTypeHash } from './eip712'
import {
  Erc7730CalldataIndex,
  Erc7730Descriptor,
  Erc7730Eip712Index,
  Erc7730Eip712IndexEntry,
  Erc7730RelayerCall,
  Erc7730ResolvedDescriptor,
  Erc7730TypedDataTypes
} from './types'

const ERC7730_CALLDATA_INDEX_RELAYER_PATH = '/v2/erc7730/account-op/clear-signing'
const ERC7730_EIP712_INDEX_RELAYER_PATH = '/v2/erc7730/eip-712/clear-signing'
const ERC7730_DESCRIPTOR_PATH = '/v2/erc7730/fetch-descriptor/clear-signing'

const ERC20_APPROVE_SELECTOR = '0x095ea7b3'
const ERC20_TRANSFER_SELECTOR = '0xa9059cbb'
const PERMIT2_APPROVE_SELECTOR = '0x87517c45'
const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3'

const relayerCalldataIndexPromises = new WeakMap<
  Erc7730RelayerCall,
  Promise<Erc7730CalldataIndex>
>()
const relayerEip712IndexPromises = new WeakMap<Erc7730RelayerCall, Promise<Erc7730Eip712Index>>()

const ERC20_APPROVE_DESCRIPTOR: Erc7730ResolvedDescriptor = {
  path: 'built-in/erc20-approve',
  descriptor: {
    display: {
      formats: {
        'approve(address _spender, uint256 _value)': {
          intent: 'Approve',
          fields: [
            {
              path: '#._spender',
              label: 'Spender',
              format: 'addressName',
              visible: 'always'
            },
            {
              path: '#._value',
              label: 'Amount',
              format: 'tokenAmount',
              params: { tokenPath: '@.to' },
              visible: 'always'
            }
          ]
        }
      }
    }
  }
}

const ERC20_TRANSFER_DESCRIPTOR: Erc7730ResolvedDescriptor = {
  path: 'built-in/erc20-transfer',
  descriptor: {
    display: {
      formats: {
        'transfer(address _to, uint256 _value)': {
          intent: 'Send',
          fields: [
            {
              path: '_value',
              label: 'Amount',
              format: 'tokenAmount',
              params: { tokenPath: '@.to' },
              visible: 'always'
            },
            {
              path: '_to',
              label: 'To',
              format: 'addressName',
              params: { types: ['eoa'], sources: ['local', 'ens'] },
              visible: 'always'
            }
          ]
        }
      }
    }
  }
}

const PERMIT2_APPROVE_DESCRIPTOR: Erc7730ResolvedDescriptor = {
  path: 'built-in/permit2-approve',
  descriptor: {
    display: {
      formats: {
        'approve(address token, address spender, uint160 amount, uint48 expiration)': {
          intent: 'Approve',
          fields: [
            {
              path: '#.spender',
              label: 'Spender',
              format: 'addressName',
              visible: 'always'
            },
            {
              path: '#.amount',
              label: 'Amount',
              format: 'tokenAmount',
              params: { tokenPath: '#.token' },
              visible: 'always'
            },
            {
              path: '#.expiration',
              label: 'Approval expires',
              format: 'date',
              params: { encoding: 'timestamp' },
              visible: 'always'
            }
          ]
        }
      }
    }
  }
}

const getRelayerPayload = <T>(response: any, path: string): T => {
  if (response?.success === false) {
    throw new Error(`Failed to fetch ERC-7730 relayer resource: ${path}`)
  }

  if (response?.data !== undefined) return response.data as T

  if (response?.success === undefined) return response as T

  const { success, status, errorState, message, ...payload } = response
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`Invalid ERC-7730 relayer resource response: ${path}`)
  }

  return payload as T
}

const fetchRelayerResource = async <T>(
  path: string,
  callRelayer: Erc7730RelayerCall
): Promise<T> => {
  const response = await callRelayer(path, 'GET')
  const payload = getRelayerPayload<T>(response, path)

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`Invalid ERC-7730 relayer resource response: ${path}`)
  }

  return payload
}

const postRelayerResource = async <T>(
  path: string,
  callRelayer: Erc7730RelayerCall,
  body: any
): Promise<T> => {
  const response = await callRelayer(path, 'POST', body)
  const payload = getRelayerPayload<T>(response, path)

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`Invalid ERC-7730 relayer resource response: ${path}`)
  }

  return payload
}

const normalizeRelayerPath = (pathOrUrl: string): string => {
  try {
    const url = new URL(pathOrUrl)
    return `${url.pathname}${url.search}`
  } catch {
    return pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  }
}

const getIncludePath = (includePath: string, parentPath: string): string => {
  if (includePath.startsWith('/') || /^https?:\/\//.test(includePath)) {
    return normalizeRelayerPath(includePath)
  }

  return new URL(includePath, `https://relayer.local${normalizeRelayerPath(parentPath)}`).pathname
}

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
  callRelayer: Erc7730RelayerCall,
  depth = 0
): Promise<Erc7730ResolvedDescriptor> => {
  const relayerPath = normalizeRelayerPath(pathOrUrl)

  const descriptorPromise = (async () => {
    const descriptor = await postRelayerResource<Erc7730Descriptor>(
      ERC7730_DESCRIPTOR_PATH,
      callRelayer,
      {
        descriptorPath: relayerPath
      }
    )
    const includes = descriptor.includes
      ? Array.isArray(descriptor.includes)
        ? descriptor.includes
        : [descriptor.includes]
      : []

    if (!includes.length || depth >= 5) return { descriptor, path: pathOrUrl }

    const includedDescriptors = await Promise.all(
      includes.map((includePath) =>
        fetchDescriptor(getIncludePath(includePath, relayerPath), callRelayer, depth + 1)
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

  // todo: implement caching
  return descriptorPromise
}

const getCalldataIndex = async (callRelayer: Erc7730RelayerCall): Promise<Erc7730CalldataIndex> => {
  const cachedRelayerIndex = relayerCalldataIndexPromises.get(callRelayer)
  if (cachedRelayerIndex) return cachedRelayerIndex

  const relayerCalldataIndexPromise = fetchRelayerResource<Erc7730CalldataIndex>(
    ERC7730_CALLDATA_INDEX_RELAYER_PATH,
    callRelayer
  ).catch((error) => {
    relayerCalldataIndexPromises.delete(callRelayer)
    throw error
  })

  relayerCalldataIndexPromises.set(callRelayer, relayerCalldataIndexPromise)

  return relayerCalldataIndexPromise
}

const getEip712Index = async (callRelayer: Erc7730RelayerCall): Promise<Erc7730Eip712Index> => {
  const cachedRelayerIndex = relayerEip712IndexPromises.get(callRelayer)
  if (cachedRelayerIndex) return cachedRelayerIndex

  const relayerEip712IndexPromise = fetchRelayerResource<Erc7730Eip712Index>(
    ERC7730_EIP712_INDEX_RELAYER_PATH,
    callRelayer
  ).catch((error) => {
    relayerEip712IndexPromises.delete(callRelayer)
    throw error
  })

  relayerEip712IndexPromises.set(callRelayer, relayerEip712IndexPromise)

  return relayerEip712IndexPromise
}

const getRegistryKey = (chainId: bigint | number | string, address: string): string =>
  `eip155:${BigInt(chainId).toString()}:${address.toLowerCase()}`

const getBuiltInDescriptorForCall = (call: Call): Erc7730ResolvedDescriptor | null => {
  const selector = call.data.slice(0, 10).toLowerCase()

  if (selector === ERC20_APPROVE_SELECTOR) return ERC20_APPROVE_DESCRIPTOR
  if (selector === ERC20_TRANSFER_SELECTOR) return ERC20_TRANSFER_DESCRIPTOR
  if (call.to.toLowerCase() === PERMIT2_ADDRESS && selector === PERMIT2_APPROVE_SELECTOR) {
    return PERMIT2_APPROVE_DESCRIPTOR
  }

  return null
}

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
  callRelayer?: Erc7730RelayerCall
): Promise<Erc7730ResolvedDescriptor | null> => {
  if (!call.to || !isAddress(call.to)) return null

  const builtInDescriptor = getBuiltInDescriptorForCall(call)
  if (!callRelayer) return builtInDescriptor

  try {
    const index = await getCalldataIndex(callRelayer)
    const descriptorPath = index[getRegistryKey(chainId, call.to)]
    if (!descriptorPath) return builtInDescriptor

    const registryDescriptor = await fetchDescriptor(descriptorPath, callRelayer)
    if (!builtInDescriptor) return registryDescriptor

    return {
      descriptor: mergeDescriptors(builtInDescriptor.descriptor, registryDescriptor.descriptor),
      path: registryDescriptor.path
    }
  } catch (error) {
    console.error(error)
    return builtInDescriptor
  }
}

export const fetchErc7730DescriptorsForAccountOp = async (
  accountOp: AccountOp,
  callRelayer?: Erc7730RelayerCall
): Promise<Record<number, Erc7730ResolvedDescriptor>> => {
  const resolvedDescriptors = await Promise.all(
    accountOp.calls.map(async (call, index) => {
      const descriptor = await fetchErc7730DescriptorForCall(call, accountOp.chainId, callRelayer)
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
  callRelayer: Erc7730RelayerCall
): Promise<Erc7730ResolvedDescriptor | null> => {
  if (message.content.kind !== 'typedMessage') return null

  const verifyingContract = message.content.domain.verifyingContract
  const chainId = getTypedMessageChainId(message)
  if (!verifyingContract || !chainId || !isAddress(verifyingContract)) return null

  try {
    const index = await getEip712Index(callRelayer)
    const primaryType = String(message.content.primaryType)
    const entries = index[getRegistryKey(chainId, verifyingContract)]?.[primaryType]
    if (!entries?.length) return null

    const entry = selectEip712IndexEntry(
      entries,
      message.content.types as Erc7730TypedDataTypes,
      primaryType
    )
    if (!entry) return null

    return fetchDescriptor(entry.path, callRelayer)
  } catch (error) {
    console.error(error)
    return null
  }
}
