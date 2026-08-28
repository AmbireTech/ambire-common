import { getAddress, Interface, isAddress, isHexString, ZeroAddress } from 'ethers'

import {
  ERC20_APPROVE_SELECTOR,
  ERC20_TRANSFER_SELECTOR,
  PERMIT2_ADDRESS,
  PERMIT2_APPROVE_SELECTOR,
  SAFE_TX_PRIMARY_TYPE
} from '@/libs/humanizer/erc7730/consts'
import { FEE_COLLECTOR } from '../../../consts/addresses'
import { execTransactionAbi } from '../../../consts/safe'
import { Message } from '../../../interfaces/userRequest'
import { AccountOp } from '../../accountOp/accountOp'
import { Call } from '../../accountOp/types'
import { decodeMultiSend } from '../../safe/helpers'
import { getAbiBytesCalldataWithPadding, multiSendInterface } from './calldata'
import { getEip712EncodeTypeHash } from './eip712'
import { humanizeCallWithErc7730 } from './humanize'
import { MULTICALL_DESCRIPTOR, MULTICALL_SELECTOR } from './multicall'
import {
  Erc7730CalldataIndex,
  Erc7730Descriptor,
  Erc7730Eip712Index,
  Erc7730Eip712IndexEntry,
  Erc7730CallDescriptors,
  Erc7730Field,
  Erc7730Known,
  Erc7730ResolvedDescriptor,
  Erc7730Resolution,
  Erc7730TypedDataTypes,
  Erc7730Want
} from './types'
import { getRegistryKey, getSafeTxCallsFromMessage, isHexOfLength, isPlainObject } from './utils'

/** How deep `includes` chains and nested calls are followed before giving up. */
export const ERC7730_MAX_RESOLUTION_DEPTH = 5

const safeExecTransactionInterface = new Interface(execTransactionAbi)
const erc20ApproveInterface = new Interface(['function approve(address _spender, uint256 _value)'])
const erc20TransferInterface = new Interface(['function transfer(address _to, uint256 _value)'])
const permit2ApproveInterface = new Interface([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)'
])
const ABI_WORD_HEX_LENGTH = 64
const CALLDATA_SELECTOR_HEX_LENGTH = 10
const EXEC_TRANSACTION_STATIC_WORDS = 10
const ERC2612_PERMIT_ENCODE_TYPE_HASH =
  '0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9'

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

export const validateCalldataIndex = (
  payload: unknown,
  path: string
): payload is Erc7730CalldataIndex => {
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

export const validateEip712Index = (
  payload: unknown,
  path: string
): payload is Erc7730Eip712Index => {
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

export const validateDescriptor = (
  payload: unknown,
  path: string
): payload is Erc7730Descriptor => {
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

const PERMIT2_APPROVE_DESCRIPTOR = getPermit2ApproveDescriptor(
  'built-in/permit2-approve',
  'Approve'
)

const PERMIT2_REVOKE_APPROVAL_DESCRIPTOR = getPermit2ApproveDescriptor(
  'built-in/permit2-revoke-approval',
  'Revoke approval'
)

const ERC2612_PERMIT_DESCRIPTOR: Erc7730ResolvedDescriptor = {
  path: 'built-in/erc2612-permit',
  descriptor: {
    display: {
      formats: {
        'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)': {
          intent: 'Authorize spending of tokens',
          fields: [
            {
              path: 'spender',
              label: 'Spender',
              format: 'raw',
              visible: 'always'
            },
            {
              path: 'value',
              label: 'Max spending amount',
              format: 'tokenAmount',
              params: { tokenPath: '@.to' },
              visible: 'always'
            },
            {
              path: 'deadline',
              label: 'Valid until',
              format: 'date',
              params: { encoding: 'timestamp' }
            },
            {
              path: 'owner',
              label: 'Owner',
              visible: 'never'
            },
            {
              path: 'nonce',
              label: 'Nonce',
              visible: 'never'
            }
          ]
        }
      }
    }
  }
}

export const normalizeRelayerPath = (pathOrUrl: string): string => {
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

const applyBuiltInFormatOverrides = (
  descriptor: Erc7730Descriptor,
  builtInDescriptor: Erc7730ResolvedDescriptor
): Erc7730Descriptor => {
  const formats = descriptor.display?.formats
  const builtInFormats = builtInDescriptor.descriptor.display?.formats
  if (!formats || !builtInFormats) return descriptor

  Object.entries(builtInFormats).forEach(([signature, builtInFormat]) => {
    const format = formats[signature]
    if (!format) return

    if (builtInDescriptor.path?.endsWith('-revoke-approval')) {
      format.intent = builtInFormat.intent
    }

    const nativeField = builtInFormat.fields?.find(
      (field) => field.path === '@.value' && field.label === 'Send'
    )
    if (!nativeField) return

    const fields = format.fields || []
    if (
      fields.some((field) => field.path === nativeField.path && field.label === nativeField.label)
    )
      return

    format.fields = [...fields, nativeField]
  })

  return descriptor
}

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
  if (selector === MULTICALL_SELECTOR) return MULTICALL_DESCRIPTOR
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

const getBuiltInDescriptorForMessage = (message: Message): Erc7730ResolvedDescriptor | null => {
  if (message.content.kind !== 'typedMessage' || message.content.primaryType !== 'Permit')
    return null

  try {
    const encodeTypeHash = getEip712EncodeTypeHash(
      message.content.types as Erc7730TypedDataTypes,
      message.content.primaryType
    )

    return encodeTypeHash === ERC2612_PERMIT_ENCODE_TYPE_HASH ? ERC2612_PERMIT_DESCRIPTOR : null
  } catch {
    return null
  }
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

export const getAddressFromStorageSlot = (slotValue: string): string | null => {
  if (!isHexString(slotValue) || slotValue.length !== 66) return null

  const address = getAddress(`0x${slotValue.slice(-40)}`)
  return address.toLowerCase() === ZeroAddress ? null : address
}

/**
 * Picks the index entry matching a typed message. Entries without `encodeTypeHashes` match
 * anything; otherwise the message's own hash has to be among them. A message whose hash could not
 * be computed falls back to the sole entry, when there is exactly one.
 */
export const selectEip712IndexEntry = (
  entries: Erc7730Eip712IndexEntry[],
  encodeTypeHash: string | null
): Erc7730Eip712IndexEntry | null => {
  if (!encodeTypeHash) return entries.length === 1 ? entries[0]! : null

  return (
    entries.find(
      (entry) =>
        !entry.encodeTypeHashes?.length ||
        entry.encodeTypeHashes.some((hash) => hash.toLowerCase() === encodeTypeHash)
    ) || null
  )
}

const getEip712Key = (chainId: bigint, verifyingContract: string, primaryType: string): string =>
  `${getRegistryKey(chainId, verifyingContract)}:${primaryType}`

const getSafeSingletonKey = (chainId: bigint, address: string): string =>
  `${chainId.toString()}:${address.toLowerCase()}`

/**
 * Merges a descriptor with everything its `includes` point at, collecting a want for any include
 * not yet fetched. Returns null while anything is still missing, so the caller reports its wants
 * and is asked again next round.
 */
const mergeIncludes = (
  path: string,
  known: Erc7730Known,
  wants: Erc7730Want[],
  depth = 0
): Erc7730Descriptor | null => {
  const descriptor = known.descriptorsByPath[path]
  // undefined means not asked for yet; null means asked for and unavailable, so stop asking
  if (descriptor === undefined) {
    wants.push({ kind: 'includedDescriptor', path })

    return null
  }
  if (!descriptor) return null

  const includes = descriptor.includes
    ? Array.isArray(descriptor.includes)
      ? descriptor.includes
      : [descriptor.includes]
    : []

  if (!includes.length || depth >= ERC7730_MAX_RESOLUTION_DEPTH) return descriptor

  const included = includes.map((includePath) =>
    mergeIncludes(getIncludePath(includePath, path), known, wants, depth + 1)
  )
  if (included.some((one) => !one)) return null

  const mergedIncludes = included.reduce<Erc7730Descriptor>(
    (merged, one) => mergeDescriptors(merged, one!),
    {}
  )

  return mergeDescriptors(mergedIncludes, descriptor)
}

/**
 * The descriptor registered for a contract, following a Safe-style proxy to its singleton when the
 * address itself has none. Collects wants for whatever is still missing.
 */
const resolveRegisteredDescriptor = (
  chainId: bigint,
  address: string,
  known: Erc7730Known,
  wants: Erc7730Want[],
  followProxy: boolean
): Erc7730ResolvedDescriptor | null => {
  const registryKey = getRegistryKey(chainId, address)
  const registered = known.contractDescriptors[registryKey]

  if (registered === undefined) {
    wants.push({ kind: 'contractDescriptor', chainId, address })

    return null
  }

  if (registered) {
    const descriptor = mergeIncludes(registered.path, known, wants)

    return descriptor ? { descriptor, path: registered.path } : null
  }

  // Nothing registered for the address itself - it may be a proxy whose singleton has a descriptor
  if (!followProxy) return null

  const singletonKey = getSafeSingletonKey(chainId, address)
  const singleton = known.safeSingletons[singletonKey]

  if (singleton === undefined) {
    wants.push({ kind: 'safeSingleton', chainId, address })

    return null
  }
  if (!singleton || singleton.toLowerCase() === address.toLowerCase()) return null

  return resolveRegisteredDescriptor(chainId, singleton, known, wants, false)
}

type Erc7730ResolveOptions = {
  /** Needed to format the call, which is how the calls embedded in it are found */
  accountAddr?: string
}

const hasCalldataFieldCache = new WeakMap<Erc7730Descriptor, boolean>()

const fieldsContainCalldataFormat = (fields: Erc7730Field[] | undefined): boolean =>
  !!fields?.some(
    (field) => field.format === 'calldata' || fieldsContainCalldataFormat(field.fields)
  )

/**
 * Whether the descriptor describes a call that carries other calls inside it. Formatting a call is
 * the only way to find those, and it is far too expensive to do for every call, so this decides up
 * front whether it is worth doing at all.
 */
const hasCalldataField = (descriptor: Erc7730Descriptor): boolean => {
  const cached = hasCalldataFieldCache.get(descriptor)
  if (cached !== undefined) return cached

  const formats = Object.values(descriptor.display?.formats || {})
  const definitions = Object.values(descriptor.display?.definitions || {})
  const result =
    formats.some((format) => fieldsContainCalldataFormat(format.fields)) ||
    fieldsContainCalldataFormat(definitions)

  hasCalldataFieldCache.set(descriptor, result)

  return result
}

/**
 * The descriptor of every call embedded in `call` through a `format: 'calldata'` field, keyed by
 * `eip155:{chainId}:{address}`.
 *
 * The embedded calls are found by formatting the call in collect mode - the same code that will
 * later render them - so this can never ask for a descriptor the humanizer does not use, or miss
 * one it does. Each round feeds the descriptors found so far back in, because an embedded call read
 * through its own descriptor can reveal calls embedded deeper still.
 */
const resolveNestedCalldataDescriptors = (
  call: Call,
  chainId: AccountOp['chainId'],
  resolvedDescriptor: Erc7730ResolvedDescriptor,
  known: Erc7730Known,
  wants: Erc7730Want[],
  accountAddr: string
): Record<string, Erc7730ResolvedDescriptor> | undefined => {
  if (!hasCalldataField(resolvedDescriptor.descriptor)) return undefined

  const nestedCallDescriptors: Record<string, Erc7730ResolvedDescriptor> = {}

  for (let round = 0; round < ERC7730_MAX_RESOLUTION_DEPTH; round++) {
    const collectedNestedCalls: Call[] = []
    humanizeCallWithErc7730(
      call,
      chainId,
      accountAddr,
      { ...resolvedDescriptor, nestedCallDescriptors },
      undefined,
      collectedNestedCalls
    )

    let didResolveNewDescriptor = false

    collectedNestedCalls.forEach((nestedCall) => {
      if (!nestedCall.to || !isAddress(nestedCall.to)) return

      const registryKey = getRegistryKey(chainId, nestedCall.to)
      if (nestedCallDescriptors[registryKey]) return

      // A proxy lookup costs an RPC read per embedded call, and an embedded call goes to an
      // arbitrary contract, so it is not worth one
      const resolution = resolveErc7730CallWithoutNested(nestedCall, chainId, known, false, {
        accountAddr
      })
      wants.push(...resolution.wants)

      if (resolution.descriptor) {
        nestedCallDescriptors[registryKey] = resolution.descriptor
        didResolveNewDescriptor = true
      }
    })

    if (!didResolveNewDescriptor) break
  }

  return Object.keys(nestedCallDescriptors).length ? nestedCallDescriptors : undefined
}

/**
 * Everything one call needs, decided from `known` and recording what is still missing.
 *
 * This is the single traversal that both `planErc7730Wants` and `resolveErc7730Descriptors` read,
 * so the plan can never ask for something the resolve step does not use, or miss something it does.
 */
const resolveErc7730CallWithoutNested = (
  call: Call,
  chainId: AccountOp['chainId'],
  known: Erc7730Known,
  followProxy: boolean,
  options: Erc7730ResolveOptions
): Erc7730Resolution => {
  const wants: Erc7730Want[] = []
  if (!call.to || !isAddress(call.to)) return { descriptor: null, wants }
  if (isErc20TransferToFeeCollector(call)) return { descriptor: null, wants }

  const builtInDescriptor = getBuiltInDescriptorForCall(call)

  // A Safe `execTransaction` describes the transactions inside it, not the call itself
  const safeTxCalls = getSafeTxCallsFromExecTransactionCall(call)
  if (safeTxCalls?.length) {
    const singletonKey = getSafeSingletonKey(chainId, call.to)
    const singleton = known.safeSingletons[singletonKey]

    if (singleton === undefined) {
      wants.push({ kind: 'safeSingleton', chainId, address: call.to })

      return { descriptor: builtInDescriptor, wants }
    }

    if (singleton && singleton.toLowerCase() !== call.to.toLowerCase()) {
      const safeDescriptor = resolveRegisteredDescriptor(chainId, singleton, known, wants, false)
      const nested = resolveInnerCalls(safeTxCalls, chainId, known, wants, options, call.to)

      if (safeDescriptor && !wants.length) {
        return {
          descriptor: { ...safeDescriptor, innerCalls: safeTxCalls, innerCallDescriptors: nested },
          wants
        }
      }

      return { descriptor: builtInDescriptor, wants }
    }
  }

  const registryDescriptor = resolveRegisteredDescriptor(
    chainId,
    call.to,
    known,
    wants,
    // Following a proxy costs an RPC read, so only bother when nothing else describes the call
    followProxy && !builtInDescriptor
  )
  if (wants.length) return { descriptor: builtInDescriptor, wants }

  if (!registryDescriptor) return { descriptor: builtInDescriptor, wants }
  if (!builtInDescriptor) return { descriptor: registryDescriptor, wants }

  return {
    descriptor: {
      descriptor: applyBuiltInFormatOverrides(
        mergeDescriptors(builtInDescriptor.descriptor, registryDescriptor.descriptor),
        builtInDescriptor
      ),
      path: registryDescriptor.path
    },
    wants
  }
}

/**
 * The descriptor for one call, plus the descriptors of every call embedded in it.
 *
 * This is the single traversal that both `planErc7730Wants` and `resolveErc7730Descriptors` read,
 * so the plan can never ask for something the resolve step does not use, or miss something it does.
 */
export const resolveErc7730Call = (
  call: Call,
  chainId: AccountOp['chainId'],
  known: Erc7730Known,
  /**
   * Whether an address with no descriptor of its own is worth a proxy-singleton lookup. Off for the
   * inner calls of a Safe transaction: they go to arbitrary contracts, and reading a singleton slot
   * off each one is an RPC round trip that almost never finds anything.
   */
  followProxy = true,
  options: Erc7730ResolveOptions = {}
): Erc7730Resolution => {
  const resolution = resolveErc7730CallWithoutNested(call, chainId, known, followProxy, options)
  const { accountAddr } = options

  if (!accountAddr || !resolution.descriptor) return resolution

  const nestedCallDescriptors = resolveNestedCalldataDescriptors(
    call,
    chainId,
    resolution.descriptor,
    known,
    resolution.wants,
    accountAddr
  )
  if (!nestedCallDescriptors) return resolution

  return {
    descriptor: { ...resolution.descriptor, nestedCallDescriptors },
    wants: resolution.wants
  }
}

/**
 * Resolves a list of inner calls, keyed by their index within the parent.
 *
 * Only a call back to `safeAddress` itself is worth a proxy-singleton lookup - that is the Safe,
 * whose descriptor lives on its singleton. The rest go to arbitrary contracts.
 */
const resolveInnerCalls = (
  calls: Call[],
  chainId: AccountOp['chainId'],
  known: Erc7730Known,
  wants: Erc7730Want[],
  options: Erc7730ResolveOptions,
  safeAddress?: string
): Record<number, Erc7730ResolvedDescriptor> => {
  const resolved: Record<number, Erc7730ResolvedDescriptor> = {}

  calls.forEach((call, index) => {
    const isSafeItself =
      !!safeAddress && !!call.to && call.to.toLowerCase() === safeAddress.toLowerCase()
    const resolution = resolveErc7730Call(call, chainId, known, isSafeItself, options)
    wants.push(...resolution.wants)
    if (resolution.descriptor) resolved[index] = resolution.descriptor
  })

  return resolved
}

/** What the controller still has to fetch before an accountOp can be fully described. */
export const planErc7730Wants = (accountOp: AccountOp, known: Erc7730Known): Erc7730Want[] =>
  accountOp.calls.flatMap(
    (call) =>
      resolveErc7730Call(call, accountOp.chainId, known, true, {
        accountAddr: accountOp.accountAddr
      }).wants
  )

/** The descriptor for each call that has one, given everything fetched so far. */
export const resolveErc7730Descriptors = (
  accountOp: AccountOp,
  known: Erc7730Known
): Erc7730CallDescriptors => {
  const descriptors: Erc7730CallDescriptors = {}

  accountOp.calls.forEach((call, index) => {
    const { descriptor } = resolveErc7730Call(call, accountOp.chainId, known, true, {
      accountAddr: accountOp.accountAddr
    })
    if (descriptor) descriptors[index] = descriptor
  })

  return descriptors
}

/** Everything one typed message needs, in the same plan/resolve shape as a call. */
export const resolveErc7730Message = (message: Message, known: Erc7730Known): Erc7730Resolution => {
  const wants: Erc7730Want[] = []
  if (message.content.kind !== 'typedMessage') return { descriptor: null, wants }

  const verifyingContract = message.content.domain.verifyingContract
  const chainId = getTypedMessageChainId(message)
  if (!verifyingContract || !chainId || !isAddress(verifyingContract)) {
    return { descriptor: null, wants }
  }

  const primaryType = String(message.content.primaryType)
  const builtInDescriptor = getBuiltInDescriptorForMessage(message)
  let encodeTypeHash: string | null = null
  try {
    encodeTypeHash = getEip712EncodeTypeHash(
      message.content.types as Erc7730TypedDataTypes,
      primaryType
    )
  } catch {
    encodeTypeHash = null
  }

  const resolveFor = (contract: string): Erc7730ResolvedDescriptor | null => {
    const key = getEip712Key(chainId, contract, primaryType)
    const registered = known.eip712Descriptors[key]

    if (registered === undefined) {
      wants.push({
        kind: 'eip712Descriptor',
        chainId,
        verifyingContract: contract,
        primaryType,
        encodeTypeHash
      })

      return null
    }
    if (!registered) return null

    const descriptor = mergeIncludes(registered.path, known, wants)

    return descriptor ? { descriptor, path: registered.path } : null
  }

  let descriptor = resolveFor(verifyingContract)

  // A Safe message is signed against the proxy, but described by its singleton
  if (!descriptor && !wants.length && primaryType === SAFE_TX_PRIMARY_TYPE) {
    const singletonKey = getSafeSingletonKey(chainId, verifyingContract)
    const singleton = known.safeSingletons[singletonKey]

    if (singleton === undefined) {
      wants.push({ kind: 'safeSingleton', chainId, address: verifyingContract })

      return { descriptor: null, wants }
    }
    if (!singleton || singleton.toLowerCase() === verifyingContract.toLowerCase()) {
      return { descriptor: null, wants }
    }

    descriptor = resolveFor(singleton)
  }

  if (wants.length) return { descriptor: builtInDescriptor, wants }
  if (!descriptor) return { descriptor: builtInDescriptor, wants }

  // The transactions a SafeTx authorises are described by their own descriptors
  const safeTxCalls = getSafeTxCallsFromMessage(message)
  if (!safeTxCalls?.length) return { descriptor, wants }

  const nested = resolveInnerCalls(
    safeTxCalls,
    chainId,
    known,
    wants,
    { accountAddr: message.accountAddr },
    verifyingContract
  )
  if (wants.length) return { descriptor, wants }
  if (!Object.keys(nested).length) return { descriptor, wants }

  return { descriptor: { ...descriptor, innerCallDescriptors: nested }, wants }
}

export const planErc7730MessageWants = (message: Message, known: Erc7730Known): Erc7730Want[] =>
  resolveErc7730Message(message, known).wants

export const resolveErc7730MessageDescriptor = (
  message: Message,
  known: Erc7730Known
): Erc7730ResolvedDescriptor | null => resolveErc7730Message(message, known).descriptor
