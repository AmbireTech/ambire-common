import { getAddress, isAddress, isHexString, ZeroAddress } from 'ethers'

import {
  ERC20_APPROVE_SELECTOR,
  ERC20_TRANSFER_SELECTOR,
  ERC7730_CACHE_TTL_MS,
  ERC7730_CALLDATA_INDEX_RELAYER_PATH,
  ERC7730_DESCRIPTOR_PATH,
  ERC7730_EIP712_INDEX_RELAYER_PATH,
  PERMIT2_ADDRESS,
  PERMIT2_APPROVE_SELECTOR,
  SAFE_PROXY_SINGLETON_SLOT,
  SAFE_TX_PRIMARY_TYPE
} from '@/libs/humanizer/erc7730/consts'

import { Message } from '../../../interfaces/userRequest'
import { AccountOp } from '../../accountOp/accountOp'
import { Call } from '../../accountOp/types'
import { getEip712EncodeTypeHash } from './eip712'
import {
  CacheEntry,
  Erc7730CalldataIndex,
  Erc7730Descriptor,
  Erc7730Eip712Index,
  Erc7730Eip712IndexEntry,
  Erc7730Field,
  Erc7730RelayerCall,
  Erc7730ResolvedDescriptor,
  Erc7730TypedDataTypes,
  SafeSingletonProvider
} from './types'

let relayerCalldataIndexCache: CacheEntry<Erc7730CalldataIndex> | null = null
let relayerCalldataIndexPromise: Promise<Erc7730CalldataIndex> | null = null
let relayerEip712IndexCache: CacheEntry<Erc7730Eip712Index> | null = null
let relayerEip712IndexPromise: Promise<Erc7730Eip712Index> | null = null
const descriptorCache = new Map<string, CacheEntry<Erc7730Descriptor>>()
const descriptorPromises = new Map<string, Promise<Erc7730Descriptor>>()
const safeSingletonCache = new Map<string, CacheEntry<string>>()
const safeSingletonPromises = new Map<string, Promise<string | null>>()

/**
 * A helper function to use in the tests only
 */
export const clearErc7730RegistryCache = () => {
  relayerCalldataIndexCache = null
  relayerCalldataIndexPromise = null
  relayerEip712IndexCache = null
  relayerEip712IndexPromise = null
  descriptorCache.clear()
  descriptorPromises.clear()
  safeSingletonCache.clear()
  safeSingletonPromises.clear()
}

const isCacheEntryValid = <T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> =>
  !!entry && Date.now() - entry.fetchedAt < ERC7730_CACHE_TTL_MS

const createCacheEntry = <T>(value: T): CacheEntry<T> => ({ value, fetchedAt: Date.now() })

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRegistryKey = (key: string): boolean => /^eip155:\d+:0x[a-fA-F0-9]{40}$/.test(key)

const isHexHash = (value: string): boolean => /^0x[a-fA-F0-9]{64}$/.test(value)

const throwInvalidRelayerResource = (path: string): never => {
  throw new Error(`Invalid ERC-7730 relayer resource response: ${path}`)
}

const validateCalldataIndex = (payload: unknown, path: string): payload is Erc7730CalldataIndex => {
  if (!isPlainObject(payload)) throwInvalidRelayerResource(path)

  const index = payload as Record<string, unknown>

  Object.entries(index).forEach(([key, value]) => {
    if (!isRegistryKey(key) || typeof value !== 'string') throwInvalidRelayerResource(path)
  })

  return true
}

const validateEip712IndexEntry = (
  entry: unknown,
  path: string
): entry is Erc7730Eip712IndexEntry => {
  if (!isPlainObject(entry)) throwInvalidRelayerResource(path)

  const indexEntry = entry as Record<string, unknown>
  if (typeof indexEntry.path !== 'string') throwInvalidRelayerResource(path)

  const { encodeTypeHashes } = indexEntry
  if (
    encodeTypeHashes !== undefined &&
    (!Array.isArray(encodeTypeHashes) ||
      encodeTypeHashes.some((hash: unknown) => typeof hash !== 'string' || !isHexHash(hash)))
  ) {
    throwInvalidRelayerResource(path)
  }

  return true
}

const validateEip712Index = (payload: unknown, path: string): payload is Erc7730Eip712Index => {
  if (!isPlainObject(payload)) throwInvalidRelayerResource(path)

  const index = payload as Record<string, unknown>

  Object.entries(index).forEach(([registryKey, primaryTypes]) => {
    if (!isRegistryKey(registryKey) || !isPlainObject(primaryTypes)) {
      throwInvalidRelayerResource(path)
    }

    const primaryTypesIndex = primaryTypes as Record<string, unknown>

    Object.entries(primaryTypesIndex).forEach(([primaryType, entries]) => {
      if (typeof primaryType !== 'string' || !Array.isArray(entries)) {
        throwInvalidRelayerResource(path)
      }

      const indexEntries = entries as unknown[]
      indexEntries.forEach((entry) => validateEip712IndexEntry(entry, path))
    })
  })

  return true
}

const validateDescriptorField = (field: unknown, path: string): field is Erc7730Field => {
  if (!isPlainObject(field)) throwInvalidRelayerResource(path)

  const descriptorField = field as Record<string, unknown>

  if (descriptorField.path !== undefined && typeof descriptorField.path !== 'string')
    throwInvalidRelayerResource(path)
  if (descriptorField.label !== undefined && typeof descriptorField.label !== 'string')
    throwInvalidRelayerResource(path)
  if (descriptorField.format !== undefined && typeof descriptorField.format !== 'string') {
    throwInvalidRelayerResource(path)
  }

  const { fields } = descriptorField
  if (fields !== undefined) {
    if (!Array.isArray(fields)) throwInvalidRelayerResource(path)

    const nestedFields = fields as unknown[]
    nestedFields.forEach((nestedField) => validateDescriptorField(nestedField, path))
  }

  return true
}

const validateDescriptor = (payload: unknown, path: string): payload is Erc7730Descriptor => {
  if (!isPlainObject(payload)) throwInvalidRelayerResource(path)

  const descriptor = payload as Record<string, unknown>
  const { includes } = descriptor

  if (
    includes !== undefined &&
    typeof includes !== 'string' &&
    (!Array.isArray(includes) ||
      includes.some((includePath: unknown) => typeof includePath !== 'string'))
  ) {
    throwInvalidRelayerResource(path)
  }

  const { display } = descriptor
  if (display === undefined) return true
  if (!isPlainObject(display)) throwInvalidRelayerResource(path)

  const { formats, definitions } = display as Record<string, unknown>
  if (definitions !== undefined && !isPlainObject(definitions)) throwInvalidRelayerResource(path)
  if (formats === undefined) return true
  if (!isPlainObject(formats)) throwInvalidRelayerResource(path)

  const descriptorFormats = formats as Record<string, unknown>

  Object.values(descriptorFormats).forEach((format: unknown) => {
    if (!isPlainObject(format)) throwInvalidRelayerResource(path)

    const descriptorFormat = format as Record<string, unknown>
    if (descriptorFormat.intent !== undefined && typeof descriptorFormat.intent !== 'string') {
      throwInvalidRelayerResource(path)
    }

    const { fields } = descriptorFormat
    if (fields === undefined) return
    if (!Array.isArray(fields)) throwInvalidRelayerResource(path)

    const descriptorFields = fields as unknown[]
    descriptorFields.forEach((field) => validateDescriptorField(field, path))
  })

  return true
}

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
  callRelayer: Erc7730RelayerCall,
  validate: (payload: unknown, path: string) => payload is T
): Promise<T> => {
  const response = await callRelayer(path, 'GET')
  const payload = getRelayerPayload<T>(response, path)

  validate(payload, path)

  return payload
}

const fetchCachedIndex = async <T>({
  path,
  callRelayer,
  cache,
  promise,
  validate,
  setCache,
  setPromise
}: {
  path: string
  callRelayer: Erc7730RelayerCall
  cache: CacheEntry<T> | null
  promise: Promise<T> | null
  validate: (payload: unknown, path: string) => payload is T
  setCache: (entry: CacheEntry<T> | null) => void
  setPromise: (promise: Promise<T> | null) => void
}): Promise<T> => {
  if (isCacheEntryValid(cache)) return cache.value

  setCache(null)

  if (promise) return promise

  const nextPromise = fetchRelayerResource<T>(path, callRelayer, validate)
    .then((index) => {
      setCache(createCacheEntry(index))
      return index
    })
    .finally(() => {
      setPromise(null)
    })

  setPromise(nextPromise)

  return nextPromise
}

const postRelayerResource = async <T>(
  path: string,
  callRelayer: Erc7730RelayerCall,
  body: any,
  validate: (payload: unknown, path: string) => payload is T
): Promise<T> => {
  const response = await callRelayer(path, 'POST', body)
  const payload = getRelayerPayload<T>(response, path)

  validate(payload, path)

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

const fetchDescriptorResource = async (
  relayerPath: string,
  callRelayer: Erc7730RelayerCall
): Promise<Erc7730Descriptor> => {
  const cachedDescriptor = descriptorCache.get(relayerPath)
  if (isCacheEntryValid(cachedDescriptor)) return cachedDescriptor.value

  if (cachedDescriptor) descriptorCache.delete(relayerPath)

  const pendingDescriptor = descriptorPromises.get(relayerPath)
  if (pendingDescriptor) return pendingDescriptor

  const descriptorFetchPromise = postRelayerResource<Erc7730Descriptor>(
    ERC7730_DESCRIPTOR_PATH,
    callRelayer,
    {
      descriptorPath: relayerPath
    },
    validateDescriptor
  )
    .then((descriptor) => {
      descriptorCache.set(relayerPath, createCacheEntry(descriptor))
      return descriptor
    })
    .finally(() => {
      descriptorPromises.delete(relayerPath)
    })

  descriptorPromises.set(relayerPath, descriptorFetchPromise)

  return descriptorFetchPromise
}

const fetchDescriptor = async (
  pathOrUrl: string,
  callRelayer: Erc7730RelayerCall,
  depth = 0
): Promise<Erc7730ResolvedDescriptor> => {
  const relayerPath = normalizeRelayerPath(pathOrUrl)

  const descriptorPromise = (async () => {
    const descriptor = await fetchDescriptorResource(relayerPath, callRelayer)
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

  return descriptorPromise
}

const getCalldataIndex = async (callRelayer: Erc7730RelayerCall): Promise<Erc7730CalldataIndex> => {
  return fetchCachedIndex<Erc7730CalldataIndex>({
    path: ERC7730_CALLDATA_INDEX_RELAYER_PATH,
    callRelayer,
    cache: relayerCalldataIndexCache,
    promise: relayerCalldataIndexPromise,
    validate: validateCalldataIndex,
    setCache: (entry) => {
      relayerCalldataIndexCache = entry
    },
    setPromise: (promise) => {
      relayerCalldataIndexPromise = promise
    }
  })
}

const getEip712Index = async (callRelayer: Erc7730RelayerCall): Promise<Erc7730Eip712Index> => {
  return fetchCachedIndex<Erc7730Eip712Index>({
    path: ERC7730_EIP712_INDEX_RELAYER_PATH,
    callRelayer,
    cache: relayerEip712IndexCache,
    promise: relayerEip712IndexPromise,
    validate: validateEip712Index,
    setCache: (entry) => {
      relayerEip712IndexCache = entry
    },
    setPromise: (promise) => {
      relayerEip712IndexPromise = promise
    }
  })
}

const getRegistryKey = (chainId: bigint | number | string, address: string): string =>
  `eip155:${BigInt(chainId).toString()}:${address.toLowerCase()}`

const getBuiltInDescriptorForCall = (call: Call): Erc7730ResolvedDescriptor | null => {
  const selector = call.data.slice(0, 10).toLowerCase()

  if (selector === ERC20_APPROVE_SELECTOR) return ERC20_APPROVE_DESCRIPTOR
  if (selector === ERC20_TRANSFER_SELECTOR) return ERC20_TRANSFER_DESCRIPTOR
  if (
    call.to &&
    call.to.toLowerCase() === PERMIT2_ADDRESS &&
    selector === PERMIT2_APPROVE_SELECTOR
  ) {
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

const getAddressFromStorageSlot = (slotValue: string): string | null => {
  if (!isHexString(slotValue) || slotValue.length < 40) return null

  const address = getAddress(`0x${slotValue.slice(-40)}`)
  return address.toLowerCase() === ZeroAddress ? null : address
}

const getSafeSingletonCacheKey = (chainId: bigint, safeAddress: string): string =>
  `${chainId.toString()}:${safeAddress.toLowerCase()}`

const getSafeSingletonFromProxy = async (
  provider: SafeSingletonProvider | undefined,
  chainId: bigint,
  safeAddress: string
): Promise<string | null> => {
  if (!provider) return null

  const cacheKey = getSafeSingletonCacheKey(chainId, safeAddress)
  const cachedSingleton = safeSingletonCache.get(cacheKey)
  if (isCacheEntryValid(cachedSingleton)) return cachedSingleton.value

  if (cachedSingleton) safeSingletonCache.delete(cacheKey)

  const pendingSingleton = safeSingletonPromises.get(cacheKey)
  if (pendingSingleton) return pendingSingleton

  const singletonPromise = provider
    .getStorage(safeAddress, SAFE_PROXY_SINGLETON_SLOT)
    .then((slotValue) => {
      const singletonAddress = getAddressFromStorageSlot(slotValue)
      if (singletonAddress) safeSingletonCache.set(cacheKey, createCacheEntry(singletonAddress))

      return singletonAddress
    })
    .catch((error) => {
      console.error(error)
      return null
    })
    .finally(() => {
      safeSingletonPromises.delete(cacheKey)
    })

  safeSingletonPromises.set(cacheKey, singletonPromise)

  return singletonPromise
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

const fetchEip712DescriptorFromIndex = async (
  index: Erc7730Eip712Index,
  chainId: bigint,
  verifyingContract: string,
  types: Erc7730TypedDataTypes,
  primaryType: string,
  callRelayer: Erc7730RelayerCall
): Promise<Erc7730ResolvedDescriptor | null> => {
  const entries = index[getRegistryKey(chainId, verifyingContract)]?.[primaryType]
  if (!entries?.length) return null

  const entry = selectEip712IndexEntry(entries, types, primaryType)
  if (!entry) return null

  return fetchDescriptor(entry.path, callRelayer)
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
  callRelayer: Erc7730RelayerCall,
  provider?: SafeSingletonProvider
): Promise<Erc7730ResolvedDescriptor | null> => {
  if (message.content.kind !== 'typedMessage') return null

  const verifyingContract = message.content.domain.verifyingContract
  const chainId = getTypedMessageChainId(message)
  if (!verifyingContract || !chainId || !isAddress(verifyingContract)) return null
  const primaryType = String(message.content.primaryType)
  const types = message.content.types as Erc7730TypedDataTypes

  try {
    const index = await getEip712Index(callRelayer)
    const registryDescriptor = await fetchEip712DescriptorFromIndex(
      index,
      chainId,
      verifyingContract,
      types,
      primaryType,
      callRelayer
    )
    if (registryDescriptor) return registryDescriptor

    if (primaryType !== SAFE_TX_PRIMARY_TYPE) return null

    const safeSingleton = await getSafeSingletonFromProxy(provider, chainId, verifyingContract)
    if (!safeSingleton || safeSingleton.toLowerCase() === verifyingContract.toLowerCase()) {
      return null
    }

    return await fetchEip712DescriptorFromIndex(
      index,
      chainId,
      safeSingleton,
      types,
      primaryType,
      callRelayer
    )
  } catch (error) {
    console.error(error)
    return null
  }
}
