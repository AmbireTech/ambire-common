import { getAddress, Interface, isAddress, isHexString, ZeroAddress } from 'ethers'

import {
  ERC20_APPROVE_SELECTOR,
  ERC20_TRANSFER_SELECTOR,
  ERC7730_CACHE_TTL_MS,
  ERC7730_CALLDATA_INDEX_RELAYER_PATH,
  ERC7730_DESCRIPTOR_PATH,
  ERC7730_DESCRIPTOR_WAIT_MS,
  ERC7730_EIP712_INDEX_RELAYER_PATH,
  PERMIT2_ADDRESS,
  PERMIT2_APPROVE_SELECTOR,
  SAFE_PROXY_SINGLETON_SLOT,
  SAFE_SINGLETON_CACHE_TTL_MS,
  SAFE_TX_PRIMARY_TYPE
} from '@/libs/humanizer/erc7730/consts'
import { BindedRelayerCall } from '@/libs/relayerCall/relayerCall'

import { FEE_COLLECTOR } from '../../../consts/addresses'
import { execTransactionAbi } from '../../../consts/safe'
import { Message } from '../../../interfaces/userRequest'
import { withTimeout } from '../../../utils/with-timeout'
import { AccountOp } from '../../accountOp/accountOp'
import { Call } from '../../accountOp/types'
import { decodeMultiSend } from '../../safe/safe'
import { getAbiBytesCalldataWithPadding, multiSendInterface } from './calldata'
import { getEip712EncodeTypeHash } from './eip712'
import { fetchRelayerResource } from './fetch'
import {
  CacheEntry,
  Erc7730CalldataIndex,
  Erc7730Descriptor,
  Erc7730Eip712Index,
  Erc7730Eip712IndexEntry,
  Erc7730Field,
  Erc7730RegistryOptions,
  Erc7730ResolvedDescriptor,
  Erc7730TypedDataTypes,
  SafeSingletonProvider
} from './types'
import { getSafeTxCallsFromMessage, isHexOfLength, isPlainObject } from './utils'

let relayerCalldataIndexCache: CacheEntry<Erc7730CalldataIndex> | null = null
let relayerCalldataIndexPromise: Promise<Erc7730CalldataIndex> | null = null
let relayerEip712IndexCache: CacheEntry<Erc7730Eip712Index> | null = null
let relayerEip712IndexPromise: Promise<Erc7730Eip712Index> | null = null
const descriptorCache = new Map<string, CacheEntry<Erc7730Descriptor>>()
const descriptorPromises = new Map<string, Promise<Erc7730Descriptor>>()
const safeSingletonCache = new Map<string, CacheEntry<string>>()
const safeSingletonPromises = new Map<string, Promise<string | null>>()
const safeExecTransactionInterface = new Interface(execTransactionAbi)
const erc20ApproveInterface = new Interface(['function approve(address _spender, uint256 _value)'])
const erc20TransferInterface = new Interface(['function transfer(address _to, uint256 _value)'])
const permit2ApproveInterface = new Interface([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)'
])
const ABI_WORD_HEX_LENGTH = 64
const CALLDATA_SELECTOR_HEX_LENGTH = 10
const EXEC_TRANSACTION_STATIC_WORDS = 10

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

const createCacheEntry = <T>(value: T): CacheEntry<T> => ({ value, fetchedAt: Date.now() })

const isDecimalString = (value: string) =>
  !!value && [...value].every((char) => char >= '0' && char <= '9')

const isRegistryKey = (key: string): boolean => {
  const parts = key.split(':')

  return (
    parts.length === 3 &&
    parts[0] === 'eip155' &&
    isDecimalString(parts[1]!) &&
    isHexOfLength(parts[2]!, 40)
  )
}

const isHexHash = (value: string): boolean => isHexOfLength(value, 64)

function throwInvalidRelayerResource(path: string): never {
  throw new Error(`Invalid ERC-7730 relayer resource response: ${path}`)
}

const validateCalldataIndex = (payload: unknown, path: string): payload is Erc7730CalldataIndex => {
  if (!isPlainObject(payload)) throwInvalidRelayerResource(path)

  const index = payload

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

  const indexEntry = entry
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

  const index = payload

  Object.entries(index).forEach(([registryKey, primaryTypes]) => {
    if (!isRegistryKey(registryKey) || !isPlainObject(primaryTypes)) {
      throwInvalidRelayerResource(path)
    }

    const primaryTypesIndex = primaryTypes

    Object.entries(primaryTypesIndex).forEach(([primaryType, entries]) => {
      if (typeof primaryType !== 'string' || !Array.isArray(entries)) {
        throwInvalidRelayerResource(path)
      }

      const indexEntries = entries
      indexEntries.forEach((entry) => validateEip712IndexEntry(entry, path))
    })
  })

  return true
}

const validateDescriptorField = (field: unknown, path: string): field is Erc7730Field => {
  if (!isPlainObject(field)) throwInvalidRelayerResource(path)

  const descriptorField = field

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

    const nestedFields = fields
    nestedFields.forEach((nestedField) => validateDescriptorField(nestedField, path))
  }

  return true
}

const validateDescriptor = (payload: unknown, path: string): payload is Erc7730Descriptor => {
  if (!isPlainObject(payload)) throwInvalidRelayerResource(path)

  const descriptor = payload
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

  const { formats, definitions } = display
  if (definitions !== undefined && !isPlainObject(definitions)) throwInvalidRelayerResource(path)
  if (formats === undefined) return true
  if (!isPlainObject(formats)) throwInvalidRelayerResource(path)

  const descriptorFormats = formats

  Object.values(descriptorFormats).forEach((format: unknown) => {
    if (!isPlainObject(format)) throwInvalidRelayerResource(path)

    const descriptorFormat = format
    if (descriptorFormat.intent !== undefined && typeof descriptorFormat.intent !== 'string') {
      throwInvalidRelayerResource(path)
    }

    const { fields } = descriptorFormat
    if (fields === undefined) return
    if (!Array.isArray(fields)) throwInvalidRelayerResource(path)

    const descriptorFields = fields
    descriptorFields.forEach((field) => validateDescriptorField(field, path))
  })

  return true
}

const getErc20ApproveDescriptor = (
  path: string,
  intent: string,
  spenderLabel: string
): Erc7730ResolvedDescriptor => ({
  path,
  descriptor: {
    display: {
      formats: {
        'approve(address _spender, uint256 _value)': {
          intent,
          fields: [
            {
              path: '#._spender',
              label: spenderLabel,
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
})

const ERC20_APPROVE_DESCRIPTOR = getErc20ApproveDescriptor(
  'built-in/erc20-approve',
  'Approve',
  'Spender'
)

const ERC20_REVOKE_APPROVAL_DESCRIPTOR = getErc20ApproveDescriptor(
  'built-in/erc20-revoke-approval',
  'Revoke approval',
  'Spender'
)

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

const getPermit2ApproveDescriptor = (path: string, intent: string): Erc7730ResolvedDescriptor => ({
  path,
  descriptor: {
    display: {
      formats: {
        'approve(address token, address spender, uint160 amount, uint48 expiration)': {
          intent,
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
})

const PERMIT2_APPROVE_DESCRIPTOR = getPermit2ApproveDescriptor('built-in/permit2-approve', 'Approve')

const PERMIT2_REVOKE_APPROVAL_DESCRIPTOR = getPermit2ApproveDescriptor(
  'built-in/permit2-revoke-approval',
  'Revoke approval'
)

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
  callRelayer: BindedRelayerCall
  cache: CacheEntry<T> | null
  promise: Promise<T> | null
  validate: (payload: unknown, path: string) => payload is T
  setCache: (entry: CacheEntry<T> | null) => void
  setPromise: (promise: Promise<T> | null) => void
}): Promise<T> => {
  if (cache && Date.now() - cache.fetchedAt < ERC7730_CACHE_TTL_MS) return cache.value

  if (promise) return promise

  const nextPromise = fetchRelayerResource<T>(path, 'GET', callRelayer, validate)
    .then((index) => {
      setCache(createCacheEntry(index))
      return index
    })
    .catch((e) => {
      // serve stale cache if any
      if (cache) return cache.value
      throw e
    })
    .finally(() => {
      setPromise(null)
    })

  setPromise(nextPromise)

  return nextPromise
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
  if (
    includePath.startsWith('/') ||
    includePath.startsWith('http://') ||
    includePath.startsWith('https://')
  ) {
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
  callRelayer: BindedRelayerCall
): Promise<Erc7730Descriptor> => {
  const cachedDescriptor = descriptorCache.get(relayerPath)
  if (cachedDescriptor && Date.now() - cachedDescriptor.fetchedAt < ERC7730_CACHE_TTL_MS)
    return cachedDescriptor.value

  const pendingDescriptor = descriptorPromises.get(relayerPath)
  if (pendingDescriptor) return pendingDescriptor

  const descriptorFetchPromise = fetchRelayerResource<Erc7730Descriptor>(
    ERC7730_DESCRIPTOR_PATH,
    'POST',
    callRelayer,
    validateDescriptor,
    {
      descriptorPath: relayerPath
    }
  )
    .then((descriptor) => {
      descriptorCache.set(relayerPath, createCacheEntry(descriptor))
      return descriptor
    })
    .catch((e) => {
      // serve stale cache if any
      if (cachedDescriptor) return cachedDescriptor.value
      throw e
    })
    .finally(() => {
      descriptorPromises.delete(relayerPath)
    })

  descriptorPromises.set(relayerPath, descriptorFetchPromise)

  return descriptorFetchPromise
}

const fetchDescriptor = async (
  pathOrUrl: string,
  callRelayer: BindedRelayerCall,
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

const getCalldataIndex = async (callRelayer: BindedRelayerCall): Promise<Erc7730CalldataIndex> => {
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

const getEip712Index = async (callRelayer: BindedRelayerCall): Promise<Erc7730Eip712Index> => {
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

const isErc20TransferToFeeCollector = (call: Call): boolean => {
  if (!call.data || call.data.slice(0, 10).toLowerCase() !== ERC20_TRANSFER_SELECTOR) return false

  try {
    const [to] = erc20TransferInterface.decodeFunctionData('transfer', call.data)

    return typeof to === 'string' && to.toLowerCase() === FEE_COLLECTOR.toLowerCase()
  } catch {
    return false
  }
}

const getBuiltInDescriptorForCall = (call: Call): Erc7730ResolvedDescriptor | null => {
  if (!call.data || !isHexString(call.data)) return null

  const selector = call.data.slice(0, 10).toLowerCase()

  if (selector === ERC20_APPROVE_SELECTOR) {
    try {
      const [, value] = erc20ApproveInterface.decodeFunctionData('approve', call.data)

      return value === 0n ? ERC20_REVOKE_APPROVAL_DESCRIPTOR : ERC20_APPROVE_DESCRIPTOR
    } catch {
      return ERC20_APPROVE_DESCRIPTOR
    }
  }
  if (selector === ERC20_TRANSFER_SELECTOR) return ERC20_TRANSFER_DESCRIPTOR
  if (
    call.to &&
    call.to.toLowerCase() === PERMIT2_ADDRESS &&
    selector === PERMIT2_APPROVE_SELECTOR
  ) {
    try {
      const [, , amount] = permit2ApproveInterface.decodeFunctionData('approve', call.data)

      return amount === 0n ? PERMIT2_REVOKE_APPROVAL_DESCRIPTOR : PERMIT2_APPROVE_DESCRIPTOR
    } catch {
      return PERMIT2_APPROVE_DESCRIPTOR
    }
  }

  return null
}

const getTypedMessageChainId = (message: Message): bigint | null => {
  if (message.content.kind !== 'typedMessage') return null

  try {
    return BigInt(message.content.domain.chainId ?? message.chainId)
  } catch {
    return null
  }
}

const getAbiWord = (data: string, wordIndex: number): string | null => {
  const wordStart = CALLDATA_SELECTOR_HEX_LENGTH + wordIndex * ABI_WORD_HEX_LENGTH
  const wordEnd = wordStart + ABI_WORD_HEX_LENGTH
  if (data.length < wordEnd) return null

  return data.slice(wordStart, wordEnd)
}

const getAbiWordAsBigInt = (data: string, wordIndex: number): bigint | null => {
  const word = getAbiWord(data, wordIndex)
  if (!word) return null

  try {
    return BigInt(`0x${word}`)
  } catch {
    return null
  }
}

const getAbiWordAsAddress = (data: string, wordIndex: number): string | null => {
  const word = getAbiWord(data, wordIndex)
  if (!word) return null

  const address = `0x${word.slice(-40)}`
  return isAddress(address) ? getAddress(address) : null
}

const getAbiBytesAtOffset = (data: string, offset: bigint): string | null => {
  if (offset < BigInt(EXEC_TRANSACTION_STATIC_WORDS * 32)) return null
  if (offset > BigInt(Number.MAX_SAFE_INTEGER)) return null

  const lengthStart = CALLDATA_SELECTOR_HEX_LENGTH + Number(offset) * 2
  const lengthEnd = lengthStart + ABI_WORD_HEX_LENGTH
  if (data.length < lengthEnd) return null

  let byteLength: bigint
  try {
    byteLength = BigInt(`0x${data.slice(lengthStart, lengthEnd)}`)
  } catch {
    return null
  }

  if (byteLength > BigInt(Number.MAX_SAFE_INTEGER)) return null

  const valueStart = lengthEnd
  const valueEnd = valueStart + Number(byteLength) * 2
  if (data.length < valueEnd) return null

  return `0x${data.slice(valueStart, valueEnd)}`
}

const getSafeTxCallsFromExecTransactionHead = (call: Call): Call[] | null => {
  if (!call.data || !isHexString(call.data)) return null

  const selector = call.data.slice(0, CALLDATA_SELECTOR_HEX_LENGTH).toLowerCase()
  if (selector !== safeExecTransactionInterface.getFunction('execTransaction')?.selector) {
    return null
  }

  const to = getAbiWordAsAddress(call.data, 0)
  const value = getAbiWordAsBigInt(call.data, 1)
  const dataOffset = getAbiWordAsBigInt(call.data, 2)
  const operation = getAbiWordAsBigInt(call.data, 3)
  if (!to || value === null || dataOffset === null || operation === null) return null

  const data = getAbiBytesAtOffset(call.data, dataOffset)
  if (data === null) return null

  if (operation === 0n) return [{ to, data, value }]
  if (operation !== 1n) return null

  try {
    const multiSendDecoded = multiSendInterface.decodeFunctionData(
      'multiSend',
      getAbiBytesCalldataWithPadding(data)
    )
    const transactionsHex = multiSendDecoded[0]
    if (typeof transactionsHex !== 'string') return null

    return decodeMultiSend(transactionsHex).map((transaction) => ({
      to: transaction.to,
      data: transaction.data,
      value: transaction.value
    }))
  } catch {
    return null
  }
}

const getSafeTxCallsFromExecTransactionCall = (call: Call): Call[] | null => {
  if (!call.data || !isHexString(call.data)) return null

  try {
    const decoded = safeExecTransactionInterface.decodeFunctionData('execTransaction', call.data)
    const [to, value, data, operation] = decoded

    if (typeof to !== 'string' || !isAddress(to)) return null
    if (typeof data !== 'string' || !isHexString(data)) return null

    const bigintValue = BigInt(value)
    const bigintOperation = BigInt(operation)

    if (bigintOperation === 0n) {
      return [
        {
          to,
          data,
          value: bigintValue
        }
      ]
    }

    if (bigintOperation !== 1n) return null

    const multiSendDecoded = multiSendInterface.decodeFunctionData(
      'multiSend',
      getAbiBytesCalldataWithPadding(data)
    )
    const transactionsHex = multiSendDecoded[0]
    if (typeof transactionsHex !== 'string') return null

    return decodeMultiSend(transactionsHex).map((transaction) => ({
      to: transaction.to,
      data: transaction.data,
      value: transaction.value
    }))
  } catch {
    return getSafeTxCallsFromExecTransactionHead(call)
  }
}

const getAddressFromStorageSlot = (slotValue: string): string | null => {
  if (!isHexString(slotValue) || slotValue.length !== 66) return null

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
  if (cachedSingleton && Date.now() - cachedSingleton.fetchedAt < SAFE_SINGLETON_CACHE_TTL_MS)
    return cachedSingleton.value

  const pendingSingleton = safeSingletonPromises.get(cacheKey)
  if (pendingSingleton) return pendingSingleton

  const singletonPromise = withTimeout(
    () => provider.getStorage(safeAddress, SAFE_PROXY_SINGLETON_SLOT),
    {
      timeoutMs: ERC7730_DESCRIPTOR_WAIT_MS,
      message: `Timed out fetching Safe singleton: ${safeAddress}`
    }
  )
    .then((slotValue) => {
      const singletonAddress = getAddressFromStorageSlot(slotValue)
      if (singletonAddress) safeSingletonCache.set(cacheKey, createCacheEntry(singletonAddress))

      return singletonAddress
    })
    .catch((e) => {
      // serve stale if any
      if (cachedSingleton) return cachedSingleton.value
      throw e
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
  callRelayer: BindedRelayerCall
): Promise<Erc7730ResolvedDescriptor | null> => {
  const entries = index[getRegistryKey(chainId, verifyingContract)]?.[primaryType]
  if (!entries?.length) return null

  const entry = selectEip712IndexEntry(entries, types, primaryType)
  if (!entry) return null

  return fetchDescriptor(entry.path, callRelayer)
}

const getNestedSafeCallOptions = (
  safeAddress: string,
  call: Call,
  options: Erc7730RegistryOptions
): Erc7730RegistryOptions => {
  if (call.to && call.to.toLowerCase() === safeAddress.toLowerCase()) return options

  return {
    ...options,
    provider: undefined
  }
}

const addSafeTxCallDescriptor = async (
  message: Message,
  chainId: bigint,
  descriptor: Erc7730ResolvedDescriptor | null,
  options: Erc7730RegistryOptions
): Promise<Erc7730ResolvedDescriptor | null> => {
  if (!descriptor || message.content.kind !== 'typedMessage') return descriptor
  if (message.content.primaryType !== SAFE_TX_PRIMARY_TYPE) return descriptor

  const safeTxCalls = getSafeTxCallsFromMessage(message)
  if (!safeTxCalls?.length) return descriptor

  const verifyingContract = message.content.domain.verifyingContract
  const safeTxCallDescriptors = await Promise.all(
    safeTxCalls.map(async (safeTxCall, index) => {
      const safeTxCallDescriptor = await fetchErc7730DescriptorForCall(
        safeTxCall,
        chainId,
        typeof verifyingContract === 'string'
          ? getNestedSafeCallOptions(verifyingContract, safeTxCall, options)
          : options
      )

      return safeTxCallDescriptor ? [index, safeTxCallDescriptor] : null
    })
  )

  const descriptorsByIndex = Object.fromEntries(safeTxCallDescriptors.filter((x) => !!x))

  if (!Object.keys(descriptorsByIndex).length) return descriptor

  return {
    ...descriptor,
    safeTxCallDescriptor:
      safeTxCalls.length === 1 ? descriptorsByIndex[0] : descriptor.safeTxCallDescriptor,
    safeTxCallDescriptors: descriptorsByIndex
  }
}

const fetchSafeExecTransactionDescriptor = async (
  call: Call,
  chainId: AccountOp['chainId'],
  options: Erc7730RegistryOptions
): Promise<Erc7730ResolvedDescriptor | null> => {
  const { callRelayer, provider } = options
  if (!callRelayer || !provider || !call.to || !isAddress(call.to)) return null

  const safeTxCalls = getSafeTxCallsFromExecTransactionCall(call)
  if (!safeTxCalls?.length) return null

  const safeSingleton = await getSafeSingletonFromProxy(provider, chainId, call.to)
  if (!safeSingleton || safeSingleton.toLowerCase() === call.to.toLowerCase()) return null

  const index = await getCalldataIndex(callRelayer)
  const descriptorPath = index[getRegistryKey(chainId, safeSingleton)]
  if (!descriptorPath) return null

  const safeDescriptor = await fetchDescriptor(descriptorPath, callRelayer)
  const safeTxCallDescriptors = await Promise.all(
    safeTxCalls.map(async (safeTxCall, index) => {
      const descriptor = await fetchErc7730DescriptorForCall(
        safeTxCall,
        chainId,
        getNestedSafeCallOptions(call.to!, safeTxCall, options)
      )
      return descriptor ? [index, descriptor] : null
    })
  )
  return {
    ...safeDescriptor,
    safeTxCalls,
    safeTxTransactionsOnly: true,
    safeTxCallDescriptors: Object.fromEntries(safeTxCallDescriptors.filter((x) => !!x))
  }
}

const fetchProxySingletonDescriptorForCall = async (
  call: Call,
  chainId: AccountOp['chainId'],
  options: Erc7730RegistryOptions,
  index: Erc7730CalldataIndex
): Promise<Erc7730ResolvedDescriptor | null> => {
  const { callRelayer, provider } = options
  if (!callRelayer || !provider || !call.to || !isAddress(call.to)) return null

  const safeSingleton = await getSafeSingletonFromProxy(provider, chainId, call.to)
  if (!safeSingleton || safeSingleton.toLowerCase() === call.to.toLowerCase()) return null

  const descriptorPath = index[getRegistryKey(chainId, safeSingleton)]
  if (!descriptorPath) return null

  return fetchDescriptor(descriptorPath, callRelayer)
}

export const fetchErc7730DescriptorForCall = async (
  call: Call,
  chainId: AccountOp['chainId'],
  options?: Erc7730RegistryOptions
): Promise<Erc7730ResolvedDescriptor | null> => {
  if (!call.to || !isAddress(call.to)) return null
  if (isErc20TransferToFeeCollector(call)) return null

  const builtInDescriptor = getBuiltInDescriptorForCall(call)
  if (!options?.callRelayer) return builtInDescriptor

  try {
    const safeExecTransactionDescriptor = await fetchSafeExecTransactionDescriptor(
      call,
      chainId,
      options
    )
    if (safeExecTransactionDescriptor) return safeExecTransactionDescriptor

    const { callRelayer } = options
    const index = await getCalldataIndex(callRelayer)
    const descriptorPath = index[getRegistryKey(chainId, call.to)]
    const registryDescriptor = descriptorPath
      ? await fetchDescriptor(descriptorPath, callRelayer)
      : !builtInDescriptor
        ? await fetchProxySingletonDescriptorForCall(call, chainId, options, index)
        : null

    if (!registryDescriptor) return builtInDescriptor
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
  options?: Erc7730RegistryOptions
): Promise<Record<number, Erc7730ResolvedDescriptor>> => {
  const resolvedDescriptors = await Promise.all(
    accountOp.calls.map(async (call, index) => {
      const descriptor = await fetchErc7730DescriptorForCall(call, accountOp.chainId, options)
      return descriptor ? [index, descriptor] : null
    })
  )
  return Object.fromEntries(resolvedDescriptors.filter((x) => !!x))
}

export const fetchErc7730DescriptorForMessage = async (
  message: Message,
  callRelayer: BindedRelayerCall,
  provider?: SafeSingletonProvider
): Promise<Erc7730ResolvedDescriptor | null> => {
  if (message.content.kind !== 'typedMessage') return null

  const verifyingContract = message.content.domain.verifyingContract
  const chainId = getTypedMessageChainId(message)
  if (!verifyingContract || !chainId || !isAddress(verifyingContract)) return null
  const primaryType = String(message.content.primaryType)
  const types = message.content.types

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
    if (registryDescriptor) {
      return addSafeTxCallDescriptor(message, chainId, registryDescriptor, {
        callRelayer,
        provider
      })
    }

    if (primaryType !== SAFE_TX_PRIMARY_TYPE) return null

    const safeSingleton = await getSafeSingletonFromProxy(provider, chainId, verifyingContract)
    if (!safeSingleton || safeSingleton.toLowerCase() === verifyingContract.toLowerCase()) {
      return null
    }

    const safeSingletonDescriptor = await fetchEip712DescriptorFromIndex(
      index,
      chainId,
      safeSingleton,
      types,
      primaryType,
      callRelayer
    )

    return addSafeTxCallDescriptor(message, chainId, safeSingletonDescriptor, {
      callRelayer,
      provider
    })
  } catch (error) {
    console.error(error)
    return null
  }
}
