import {
  formatUnits,
  FunctionFragment,
  Interface,
  isAddress,
  isHexString,
  MaxUint256,
  ParamType,
  ZeroAddress
} from 'ethers'

import { decodeGeneralAdapterCall } from '../modules/Bundler3/generalAdapter'
import { Message } from '../../../interfaces/userRequest'
import { AccountOp } from '../../accountOp/accountOp'
import { Call } from '../../accountOp/types'
import { humanizeCallWithModules } from '../callModules'
import {
  HumanizerErc7730Row,
  HumanizerErc7730Visualization,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall,
  IrMessage
} from '../interfaces'
import { getSetAllowanceResetText } from '../modules/Allowance'
import { getDelegateCallWarning, getSafeHumanization } from '../modules/Safe'
import {
  dedupeWarnings,
  eToNative,
  flattenHumanizerVisualizations,
  getAction,
  getAddressVisualization,
  getChain,
  getErc7730RowLabel,
  getErc7730RowValues,
  getErc7730Visualization,
  getText,
  getToken,
  getWarning,
  uintToAddress
} from '../utils'
import { MAX_DISPLAYED_NESTED_CALLDATA_DEPTH, SAFE_TX_PRIMARY_TYPE } from './consts'
import { getEip712EncodeType, getEip712EncodeTypeHashFromString } from './eip712'
import {
  Erc7730Descriptor,
  Erc7730DisplayFormat,
  Erc7730Field,
  Erc7730MapReference,
  Erc7730ResolvedDescriptor,
  Erc7730TypedDataTypes,
  Erc7730VisibleRule
} from './types'
import {
  getRegistryKey,
  getSafeTxCallsFromMessage,
  isPlainObject,
  parseIntegerLiteral
} from './utils'

type DescriptorFormatMatch = {
  formatKey: string
  format: Erc7730DisplayFormat
  values: Record<string, unknown>
}

type FormatContext = {
  descriptor: Erc7730Descriptor
  descriptorPath?: string
  root: Record<string, unknown>
  chainId?: bigint
  /**
   * Warnings found while decoding the calls nested inside this one. A nested call is rendered as a
   * row, and a row has nowhere to put a warning, so the decoders push here instead and the top
   * level reads it once the whole call is formatted. Shared by every nested level, because the
   * context is threaded down unchanged.
   */
  collectedWarnings: HumanizerWarning[]
  /**
   * The descriptor of every call embedded through a `format: 'calldata'` field, keyed by
   * `eip155:{chainId}:{address}`. Threaded down unchanged, so a call embedded at any depth is
   * described by its own contract's descriptor.
   */
  nestedCallDescriptors?: Record<string, Erc7730ResolvedDescriptor>
  /**
   * Set only when the caller is looking for the embedded calls rather than for their formatting.
   * Every embedded call found is pushed here, so the registry can ask for a descriptor for it.
   */
  collectedNestedCalls?: Call[]
}

type VisibilityResult = {
  visible: boolean
  valid: boolean
}

const MAX_INTERPOLATED_VALUE_LENGTH = 80
const ABI_WORD_HEX_LENGTH = 64

const isMapReference = (value: unknown): value is Erc7730MapReference =>
  isPlainObject(value) && typeof value.map === 'string' && typeof value.keyPath === 'string'

const toBigIntOrNull = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' || typeof value === 'string') {
    try {
      return BigInt(value)
    } catch {
      return null
    }
  }

  return null
}

const normalizeComparableValue = (value: unknown): string | number | boolean | null => {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value.toLowerCase()
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value

  return String(value)
}

const matchesPrimitive = (left: unknown, right: unknown): boolean =>
  normalizeComparableValue(left) === normalizeComparableValue(right)

const getVisibility = (rule: Erc7730VisibleRule | undefined, value: unknown): VisibilityResult => {
  if (!rule || rule === 'always' || rule === 'optional') return { visible: true, valid: true }
  if (rule === 'never') return { visible: false, valid: true }

  if (rule.mustBe) {
    return {
      visible: false,
      valid: rule.mustBe.some((expectedValue) => matchesPrimitive(value, expectedValue))
    }
  }

  if (rule.ifNotIn) {
    return {
      visible: !rule.ifNotIn.some((hiddenValue) => matchesPrimitive(value, hiddenValue)),
      valid: true
    }
  }

  return { visible: true, valid: true }
}

const getPathSegments = (path: string): string[] => {
  const normalizedPath = path.startsWith('.') ? path.slice(1) : path

  return normalizedPath.split('.').filter(Boolean)
}

const normalizeSegmentIndex = (index: number, length: number): number =>
  index < 0 ? length + index : index

const bigintToAbiWordHex = (value: bigint): string | null => {
  if (value < 0n) return null

  const hex = value.toString(16)
  if (hex.length > ABI_WORD_HEX_LENGTH) return null

  return hex.padStart(ABI_WORD_HEX_LENGTH, '0')
}

const readBracketSegment = (source: unknown, segment: string): unknown => {
  if (!segment.startsWith('[') || !segment.endsWith(']')) return undefined

  const bracketContent = segment.slice(1, -1)
  const separatorIndex = bracketContent.indexOf(':')

  if (separatorIndex === -1) {
    const index = parseIntegerLiteral(bracketContent)
    if (!Array.isArray(source) || index === null) return undefined

    return source[normalizeSegmentIndex(index, source.length)]
  }

  if (separatorIndex === bracketContent.lastIndexOf(':')) {
    const hex =
      typeof source === 'string'
        ? source.startsWith('0x')
          ? source.slice(2)
          : source
        : typeof source === 'bigint'
          ? bigintToAbiWordHex(source)
          : null

    if (hex === null) return undefined

    if (hex.length % 2 !== 0) return undefined

    const startText = bracketContent.slice(0, separatorIndex)
    const endText = bracketContent.slice(separatorIndex + 1)
    const byteLength = hex.length / 2
    const start =
      startText === ''
        ? 0
        : normalizeSegmentIndex(parseIntegerLiteral(startText) ?? NaN, byteLength)
    const end =
      endText === ''
        ? byteLength
        : normalizeSegmentIndex(parseIntegerLiteral(endText) ?? NaN, byteLength)

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > byteLength
    )
      return undefined

    return `0x${hex.slice(start * 2, end * 2)}`
  }

  return undefined
}

const readPath = (source: unknown, path: string): unknown => {
  if (!path) return source

  return getPathSegments(path).reduce<unknown>((currentValue, segment) => {
    if (currentValue === undefined || currentValue === null) return undefined

    const bracketValue = readBracketSegment(currentValue, segment)
    if (bracketValue !== undefined) return bracketValue

    if (segment === '[]') return Array.isArray(currentValue) ? currentValue : undefined

    if (segment.endsWith('[]')) {
      const key = segment.slice(0, -2)
      const value = isPlainObject(currentValue) ? currentValue[key] : undefined
      return Array.isArray(value) ? value : undefined
    }

    if (Array.isArray(currentValue)) {
      const index = Number(segment)
      if (Number.isInteger(index)) return currentValue[index]

      return currentValue.map((item) => (isPlainObject(item) ? item[segment] : undefined))
    }

    return isPlainObject(currentValue) ? currentValue[segment] : undefined
  }, source)
}

const resolvePath = (path: string | undefined, context: FormatContext, base: unknown): unknown => {
  if (!path) return undefined
  if (path === '#') return context.root
  if (path.startsWith('#.')) return readPath(context.root, path.slice(2))
  if (path === '@') return context.root['@']
  if (path.startsWith('@.')) return readPath(context.root['@'], path.slice(2))
  if (path === '$') return context.descriptor
  if (path.startsWith('$.')) return readPath(context.descriptor, path.slice(2))

  const valueFromBase = readPath(base, path)
  if (valueFromBase !== undefined) return valueFromBase

  return readPath(context.root, path)
}

const resolveMapReference = (
  reference: Erc7730MapReference,
  context: FormatContext,
  base: unknown
): unknown => {
  const map = resolvePath(reference.map, context, base)
  const key = resolvePath(reference.keyPath, context, base)

  if (!isPlainObject(map) || key === undefined || key === null) return undefined

  return map[String(key)]
}

const resolveParamValue = (
  value: unknown,
  context: FormatContext,
  base: unknown,
  treatStringAsPath = false
): unknown => {
  if (isMapReference(value)) return resolveMapReference(value, context, base)
  if (
    typeof value === 'string' &&
    (treatStringAsPath ||
      value === '#' ||
      value === '$' ||
      value === '@' ||
      value.startsWith('#.') ||
      value.startsWith('$.') ||
      value.startsWith('@.'))
  )
    return resolvePath(value, context, base)

  return value
}

const valueToText = (value: unknown): string => {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') {
    if (value.startsWith('0x') && value.length > MAX_INTERPOLATED_VALUE_LENGTH) {
      return `${value.slice(0, 18)}...${value.slice(-8)}`
    }

    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) return value.map(valueToText).join(', ')

  try {
    return JSON.stringify(value, (_, nestedValue) =>
      typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue
    )
  } catch {
    return String(value)
  }
}

const normalizeDecodedParam = (value: unknown, param: ParamType): unknown => {
  if (param.baseType === 'array' && param.arrayChildren) {
    return Array.from(value as ArrayLike<unknown>).map((item) =>
      normalizeDecodedParam(item, param.arrayChildren!)
    )
  }

  if (param.baseType === 'tuple') {
    const components = param.components || []
    return components.reduce<Record<string, unknown>>((acc, component, index) => {
      if (component.name) {
        acc[component.name] = normalizeDecodedParam((value as ArrayLike<unknown>)[index], component)
      }

      return acc
    }, {})
  }

  return value
}

const decodedArgsToObject = (
  decodedArgs: ArrayLike<unknown>,
  inputs: readonly ParamType[]
): Record<string, unknown> =>
  inputs.reduce<Record<string, unknown>>((acc, input, index) => {
    const value = normalizeDecodedParam(decodedArgs[index], input)
    acc[index.toString()] = value
    if (input.name) acc[input.name] = value

    return acc
  }, {})

const getFunctionFragment = (signature: string): FunctionFragment | null => {
  try {
    const iface = new Interface([`function ${signature}`])
    const fragment = iface.fragments[0]

    return fragment?.type === 'function' ? (fragment as FunctionFragment) : null
  } catch {
    return null
  }
}

const getCalldataFormatMatch = (
  call: Call,
  descriptor: Erc7730Descriptor
): DescriptorFormatMatch | null => {
  if (!call.data || call.data.length < 10) return null

  const formats = descriptor.display?.formats || {}
  const selector = call.data.slice(0, 10).toLowerCase()

  for (const [formatKey, format] of Object.entries(formats)) {
    const fragment = getFunctionFragment(formatKey)
    if (!fragment || fragment.selector.toLowerCase() !== selector) continue

    try {
      const iface = new Interface([`function ${formatKey}`])
      const decodedArgs = iface.decodeFunctionData(fragment, call.data)

      return {
        formatKey,
        format,
        values: decodedArgsToObject(decodedArgs, fragment.inputs)
      }
    } catch {
      continue
    }
  }

  return null
}

const getSafeExecTransactionWarnings = (match: DescriptorFormatMatch): HumanizerWarning[] => {
  const fragment = getFunctionFragment(match.formatKey)
  if (fragment?.name !== 'execTransaction') return []

  const operation = toBigIntOrNull(match.values.operation)
  const to = match.values.to
  if (operation === null || typeof to !== 'string') return []

  return getDelegateCallWarning(operation, to)
}

const getTypedMessageFormatMatch = (
  message: Message,
  descriptor: Erc7730Descriptor
): DescriptorFormatMatch | null => {
  if (message.content.kind !== 'typedMessage') return null

  const formats = descriptor.display?.formats || {}
  const primaryType = String(message.content.primaryType)
  let encodeType: string | null = null
  let encodeTypeHash: string | null = null

  try {
    encodeType = getEip712EncodeType(message.content.types as Erc7730TypedDataTypes, primaryType)
    encodeTypeHash = getEip712EncodeTypeHashFromString(encodeType)
  } catch {
    encodeType = null
  }

  const entry = Object.entries(formats).find(([formatKey]) => {
    if (encodeType && formatKey === encodeType) return true
    if (!formatKey.startsWith(`${primaryType}(`)) return false
    if (!encodeTypeHash) return true

    return getEip712EncodeTypeHashFromString(formatKey) === encodeTypeHash
  })

  if (!entry) return null

  return {
    formatKey: entry[0],
    format: entry[1],
    values: message.content.message
  }
}

const formatDate = (value: unknown, field: Erc7730Field): string => {
  if (field.params?.encoding === 'blockheight') return `Block ${valueToText(value)}`

  const timestamp = toBigIntOrNull(value)
  if (timestamp === null) return valueToText(value)
  if (isNoExpirationValue(timestamp)) return 'No expiration'

  const date = new Date(Number(timestamp) * 1000)
  if (Number.isNaN(date.getTime())) return valueToText(value)

  return date.toLocaleString()
}

const isNoExpirationValue = (value: bigint): boolean => {
  if (value === MaxUint256) return true

  const hexValue = value.toString(16)
  return hexValue.length >= 8 && [...hexValue].every((char) => char.toLowerCase() === 'f')
}

const formatDuration = (value: unknown): string => {
  const duration = toBigIntOrNull(value)
  if (duration === null) return valueToText(value)

  const hours = duration / 3600n
  const minutes = (duration % 3600n) / 60n
  const seconds = duration % 60n

  return [hours, minutes, seconds].map((part) => part.toString().padStart(2, '0')).join(':')
}

const formatUnitValue = (value: unknown, field: Erc7730Field): string => {
  const amount = toBigIntOrNull(value)
  const base = typeof field.params?.base === 'string' ? field.params.base : ''
  const decimals = typeof field.params?.decimals === 'number' ? field.params.decimals : 0
  if (amount === null) return `${valueToText(value)}${base ? ` ${base}` : ''}`

  return `${formatUnits(amount, decimals)}${base ? ` ${base}` : ''}`
}

const getChainIdFromField = (
  field: Erc7730Field,
  context: FormatContext,
  base: unknown
): bigint | undefined => {
  const paramChainId = resolveParamValue(field.params?.chainId, context, base)
  const chainIdPath =
    typeof field.params?.chainIdPath === 'string'
      ? resolvePath(field.params.chainIdPath, context, base)
      : undefined
  const chainId = toBigIntOrNull(chainIdPath ?? paramChainId)

  return chainId ?? context.chainId
}

const isNativeTokenReference = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') return true
  if (typeof value !== 'string' || !isAddress(value)) return false

  return eToNative(value).toLowerCase() === ZeroAddress.toLowerCase()
}

const getNativeCurrencyAddressesFromField = (
  field: Erc7730Field,
  context: FormatContext,
  base: unknown
): string[] => {
  const nativeCurrencyAddress = field.params?.nativeCurrencyAddress
  const values = Array.isArray(nativeCurrencyAddress)
    ? nativeCurrencyAddress
    : [nativeCurrencyAddress]

  return values
    .map((value) =>
      typeof value === 'string' && isAddress(value)
        ? value
        : resolveParamValue(value, context, base)
    )
    .filter((value): value is string => typeof value === 'string' && isAddress(value))
}

const getTokenAddressFromField = (
  field: Erc7730Field,
  context: FormatContext,
  base: unknown
): string | null => {
  const nativeAddresses = getNativeCurrencyAddressesFromField(field, context, base)
  const hasTokenSource =
    typeof field.params?.tokenPath === 'string' ||
    field.params?.token !== undefined ||
    nativeAddresses.length > 0
  const tokenPath =
    typeof field.params?.tokenPath === 'string'
      ? resolvePath(field.params.tokenPath, context, base)
      : undefined
  const tokenParam = resolveParamValue(field.params?.token, context, base)
  const tokenAddress = tokenPath ?? tokenParam

  if (hasTokenSource && isNativeTokenReference(tokenAddress)) return ZeroAddress
  if (typeof tokenAddress === 'bigint') {
    const uintAddress = uintToAddress(tokenAddress)

    return nativeAddresses.some(
      (address) => eToNative(address).toLowerCase() === eToNative(uintAddress).toLowerCase()
    )
      ? ZeroAddress
      : eToNative(uintAddress)
  }
  if (typeof tokenAddress !== 'string' || !isAddress(tokenAddress)) return null

  return nativeAddresses.some(
    (address) => eToNative(address).toLowerCase() === eToNative(tokenAddress).toLowerCase()
  )
    ? ZeroAddress
    : eToNative(tokenAddress)
}

const getCollectionAddressFromField = (
  field: Erc7730Field,
  context: FormatContext,
  base: unknown
): string | null => {
  const collectionPath =
    typeof field.params?.collectionPath === 'string'
      ? resolvePath(field.params.collectionPath, context, base)
      : undefined
  const collectionParam = resolveParamValue(field.params?.collection, context, base)
  const collectionAddress = collectionPath ?? collectionParam

  return typeof collectionAddress === 'string' && isAddress(collectionAddress)
    ? collectionAddress
    : null
}

const getEnumValue = (
  value: unknown,
  field: Erc7730Field,
  context: FormatContext
): string | null => {
  const enumRef = field.params?.$ref
  if (typeof enumRef !== 'string') return null

  const enumDefinition = resolvePath(enumRef, context, context.root)
  if (!isPlainObject(enumDefinition)) return null

  const values = isPlainObject(enumDefinition.values) ? enumDefinition.values : enumDefinition
  const enumKey =
    typeof value === 'string' && isHexString(value) ? toBigIntOrNull(value)?.toString() : undefined
  const enumValue = values[enumKey || valueToText(value)]

  return typeof enumValue === 'string' ? enumValue : null
}

const formatFieldValue = (
  field: Erc7730Field,
  value: unknown,
  context: FormatContext,
  base: unknown
): HumanizerVisualization[] => {
  if (field.format === 'addressName' || field.format === 'interoperableAddressName') {
    if (typeof value === 'bigint') return [getAddressVisualization(uintToAddress(value))]

    return typeof value === 'string' && isAddress(value)
      ? [getAddressVisualization(value)]
      : [getText(valueToText(value))]
  }

  if (field.format === 'tokenAmount') {
    const threshold = toBigIntOrNull(field.params?.threshold)
    const amount = toBigIntOrNull(value)
    if (threshold !== null && amount !== null && amount >= threshold && field.params?.message) {
      return [getText(valueToText(field.params.message))]
    }

    const tokenAddress = getTokenAddressFromField(field, context, base)
    if (amount !== null && tokenAddress) {
      return [getToken(tokenAddress, amount, getChainIdFromField(field, context, base))]
    }
  }

  if (field.format === 'amount') {
    const amount = toBigIntOrNull(value)
    const tokenAddress = getTokenAddressFromField(field, context, base) || ZeroAddress
    if (amount !== null) {
      return [getToken(tokenAddress, amount, getChainIdFromField(field, context, base))]
    }
  }

  if (field.format === 'nftName') {
    const tokenId = toBigIntOrNull(value)
    const collectionAddress = getCollectionAddressFromField(field, context, base)
    if (tokenId !== null && collectionAddress) {
      return [getToken(collectionAddress, tokenId, getChainIdFromField(field, context, base))]
    }
  }

  if (field.format === 'chainId') {
    const chainId = toBigIntOrNull(value)
    return chainId !== null ? [getChain(chainId)] : [getText(valueToText(value))]
  }

  if (field.format === 'date') return [getText(formatDate(value, field))]
  if (field.format === 'duration') return [getText(formatDuration(value))]
  if (field.format === 'unit') return [getText(formatUnitValue(value, field))]
  if (field.format === 'enum')
    return [getText(getEnumValue(value, field, context) || valueToText(value))]
  if (typeof value === 'string' && isAddress(value)) return [getAddressVisualization(value)]

  return [getText(valueToText(value))]
}

// A field value is usually a literal, but ERC-7730 also allows it to be a descriptor
// path pointing at a constant authored in the file itself (e.g. the vault ticker in
// `$.metadata.constants.vaultTicker`), which has to be resolved before it is displayed
const getFieldValue = (field: Erc7730Field, context: FormatContext, base: unknown): unknown => {
  if (field.value === undefined) return resolvePath(field.path, context, base)

  return typeof field.value === 'string' && (field.value === '$' || field.value.startsWith('$.'))
    ? resolvePath(field.value, context, base)
    : field.value
}

const getArrayValueAt = (value: unknown, index: number): unknown =>
  Array.isArray(value) ? value[index] : value

/**
 * A Morpho general adapter carries the action it performs in its own calldata and has no ERC-7730
 * descriptor of its own, so nothing above this can describe it. Tried only after the embedded call
 * failed to find a descriptor, so a descriptor always wins over this.
 */
const getGeneralAdapterCalldataValue = (
  context: FormatContext,
  calldata: unknown,
  callee: unknown,
  amount: unknown
): HumanizerVisualization[] | null => {
  if (typeof calldata !== 'string' || !calldata.startsWith('0x')) return null
  if (typeof callee !== 'string' || !isAddress(callee)) return null

  const accountAddr = resolvePath('#.@.accountAddr', context, context.root)
  if (typeof accountAddr !== 'string' || !isAddress(accountAddr)) return null

  const decodedCall = decodeGeneralAdapterCall(accountAddr, {
    to: callee,
    data: calldata,
    value: toBigIntOrNull(amount) || 0n
  })
  const decodedValue = decodedCall.fullVisualization?.filter((item) => item.type !== 'break')

  return decodedValue?.length ? decodedValue : null
}

const getNestedErc7730CalldataValue = (
  context: FormatContext,
  calldata: unknown,
  callee: unknown,
  amount: unknown
): (HumanizerVisualization & HumanizerErc7730Visualization) | null => {
  // No depth limit here on purpose: every nested calldata is a part of its parent
  // calldata, so it is always shorter and the recursion always stops. A depth limit
  // in the library hides the warnings of the deeply embedded calls. The limit for how
  // deep the nested calls are shown is applied in the UI.
  if (typeof calldata !== 'string' || !calldata.startsWith('0x') || calldata.length < 10)
    return null
  if (typeof callee !== 'string' || !isAddress(callee)) return null
  if (!context.chainId) return null
  // A descriptor that points at the calldata of its own call would recurse forever
  const parentCalldata = resolvePath('#.@.data', context, context.root)
  if (typeof parentCalldata === 'string' && parentCalldata === calldata) return null

  const accountAddr = resolvePath('#.@.accountAddr', context, context.root)
  if (typeof accountAddr !== 'string' || !isAddress(accountAddr)) return null

  const nestedCall = {
    to: callee,
    data: calldata,
    value: toBigIntOrNull(amount) || 0n
  }
  context.collectedNestedCalls?.push(nestedCall)

  // The descriptor of the contract the embedded call actually goes to, fetched for it by the
  // registry. The descriptor of the call that carries it stands in only when both go to the same
  // contract, which is the one case where it describes the embedded call too. For any other
  // contract the embedded call is left to the plain humanizer modules further down, rather than
  // described by a format of an unrelated contract that happens to share a selector.
  const parentCallee = resolvePath('#.@.to', context, context.root)
  const isSameContract =
    typeof parentCallee === 'string' && parentCallee.toLowerCase() === callee.toLowerCase()
  const nestedDescriptor =
    context.nestedCallDescriptors?.[getRegistryKey(context.chainId, callee)] ||
    (isSameContract ? { descriptor: context.descriptor, path: context.descriptorPath } : null)
  if (!nestedDescriptor) return null

  const humanizedCall = humanizeCallWithErc7730(
    nestedCall,
    context.chainId,
    accountAddr,
    { ...nestedDescriptor, nestedCallDescriptors: context.nestedCallDescriptors },
    undefined,
    context.collectedNestedCalls
  )
  const erc7730Visualization = humanizedCall?.fullVisualization?.find(
    (visualization) => visualization.type === 'erc7730'
  )
  if (erc7730Visualization?.type !== 'erc7730') return null

  context.collectedWarnings.push(...(humanizedCall?.warnings || []))

  return erc7730Visualization
}

const resolveCalldataParam = (
  field: Erc7730Field,
  context: FormatContext,
  base: unknown,
  pathKey: string,
  valueKey: string
): unknown => {
  const pathParam = field.params?.[pathKey]
  if (typeof pathParam === 'string') return resolvePath(pathParam, context, base)

  return resolveParamValue(field.params?.[valueKey], context, base, true)
}

const getCalldataRows = (
  field: Erc7730Field,
  value: unknown,
  context: FormatContext,
  base: unknown
): HumanizerErc7730Row[] | null => {
  const values = Array.isArray(value) ? value : [value]
  const calleeValues = resolveCalldataParam(field, context, base, 'calleePath', 'callee')
  const selectorValues = resolveCalldataParam(field, context, base, 'selectorPath', 'selector')
  const amountValues = resolveCalldataParam(field, context, base, 'amountPath', 'amount')
  const accountAddr = resolvePath('#.@.accountAddr', context, context.root)

  return values.reduce<HumanizerErc7730Row[] | null>((acc, calldata, index) => {
    if (!acc) return null

    const rowValue: HumanizerVisualization[] = []
    const callee = getArrayValueAt(calleeValues, index)
    const selector = getArrayValueAt(selectorValues, index)
    const amount = getArrayValueAt(amountValues, index)

    const nestedVisualization = getNestedErc7730CalldataValue(context, calldata, callee, amount)
    if (nestedVisualization) {
      acc.push({ type: 'call', value: [nestedVisualization] })

      return acc
    }

    const generalAdapterValue = getGeneralAdapterCalldataValue(context, calldata, callee, amount)
    if (generalAdapterValue) {
      acc.push({ type: 'call', value: generalAdapterValue })

      return acc
    }

    if (
      typeof calldata === 'string' &&
      typeof callee === 'string' &&
      isAddress(callee) &&
      typeof accountAddr === 'string' &&
      context.chainId
    ) {
      const call = { to: callee, data: calldata, value: toBigIntOrNull(amount) || 0n }
      const moduleFallbackValue = getModuleFallbackValue(
        call,
        context.chainId,
        accountAddr,
        context.collectedWarnings
      )

      if (moduleFallbackValue) {
        acc.push({ type: 'call', value: moduleFallbackValue })

        return acc
      }
    }

    if (typeof callee === 'string' && isAddress(callee)) {
      rowValue.push(getAddressVisualization(callee))
    }

    if (typeof selector === 'string') {
      rowValue.push(getText(selector))
    } else if (typeof calldata === 'string' && calldata.startsWith('0x') && calldata.length >= 10) {
      rowValue.push(getText(calldata.slice(0, 10)))
    } else {
      rowValue.push(getText(valueToText(calldata)))
    }

    acc.push({ type: 'call', value: rowValue })

    return acc
  }, [])
}

const isZeroAddressValue = (value: unknown): boolean =>
  typeof value === 'string' && isAddress(value) && value.toLowerCase() === ZeroAddress

const shouldHideZeroAddressToRow = (field: Erc7730Field, value: unknown): boolean => {
  const label = (field.label || field.path || '').trim().toLowerCase()

  return label === 'to' && isZeroAddressValue(value)
}

const resolveFieldReference = (field: Erc7730Field, context: FormatContext): Erc7730Field => {
  if (!field.$ref) return field

  const referencedField = resolvePath(field.$ref, context, context.root)
  if (!isPlainObject(referencedField)) return field

  return {
    ...(referencedField as Erc7730Field),
    ...field,
    $ref: undefined
  }
}

const ARRAY_SEGMENT = '[]'

// Substitutes the array iterator segment (`[]`) in a path with a concrete
// index, e.g. "details.[].amount" + 1 -> "details.1.amount".
const substituteArrayIndex = (path: string, index: number): string =>
  getPathSegments(path)
    .map((segment) => (segment === ARRAY_SEGMENT ? String(index) : segment))
    .join('.')

// Applies substituteArrayIndex to every string param that itself references
// the same array (e.g. tokenPath, chainIdPath, collectionPath), so a leaf
// field like `details.[].amount` with `params.tokenPath: details.[].token`
// resolves both to the same array item instead of collapsing to arrays.
const substituteArrayIndexInParams = (
  params: Erc7730Field['params'],
  index: number
): Erc7730Field['params'] => {
  if (!params) return params

  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === 'string' && value.includes(ARRAY_SEGMENT)
        ? substituteArrayIndex(value, index)
        : value
    ])
  )
}

const fieldToRows = (
  field: Erc7730Field,
  context: FormatContext,
  base: unknown
): HumanizerErc7730Row[] | null => {
  const resolvedField = resolveFieldReference(field, context)

  // A leaf field (no `fields` sub-array) whose own path iterates an array,
  // e.g. "details.[].amount", means "one row per array element" per the
  // ERC-7730 spec. Expand it into one indexed field per item so path/params
  // (e.g. tokenPath) resolve against the same array element instead of each
  // independently collapsing to the whole array.
  if (!resolvedField.fields?.length && resolvedField.path?.includes(ARRAY_SEGMENT)) {
    const arraySegmentEnd = resolvedField.path.indexOf(ARRAY_SEGMENT) + ARRAY_SEGMENT.length
    const arrayValue = resolvePath(resolvedField.path.slice(0, arraySegmentEnd), context, base)

    if (Array.isArray(arrayValue)) {
      return arrayValue.reduce<HumanizerErc7730Row[] | null>((acc, _, index) => {
        if (!acc) return null

        const indexedField: Erc7730Field = {
          ...resolvedField,
          path: substituteArrayIndex(resolvedField.path as string, index),
          params: substituteArrayIndexInParams(resolvedField.params, index)
        }
        const rows = fieldToRows(indexedField, context, base)
        if (!rows) return null
        acc.push(...rows)

        return acc
      }, [])
    }
  }

  const value = getFieldValue(resolvedField, context, base)
  const visibility = getVisibility(resolvedField.visible, value)

  if (!visibility.valid) return null
  if (!visibility.visible) return []

  if (resolvedField.fields?.length) {
    const groupedValue = value ?? base
    const groupedValues = Array.isArray(groupedValue) ? groupedValue : [groupedValue]

    return groupedValues.reduce<HumanizerErc7730Row[] | null>((acc, item) => {
      if (!acc) return null

      const nestedRows = fieldsToRows(resolvedField.fields || [], context, item)
      if (!nestedRows) return null
      acc.push(...nestedRows)

      return acc
    }, [])
  }

  if (value === undefined) return resolvedField.visible === 'optional' ? [] : null
  if (shouldHideZeroAddressToRow(resolvedField, value)) return []
  if (resolvedField.format === 'calldata')
    return getCalldataRows(resolvedField, value, context, base)

  // Every `formatFieldValue` branch renders a field as exactly one visualization, which is what
  // makes a non-`calldata` row a single labelled value.
  const [formattedValue] = formatFieldValue(resolvedField, value, context, base)
  if (!formattedValue) return null

  return [
    {
      type: 'single-value',
      label: resolvedField.label || resolvedField.path || '',
      value: formattedValue,
      path: resolvedField.path ?? ''
    }
  ]
}

const fieldsToRows = (
  fields: Erc7730Field[],
  context: FormatContext,
  base: unknown
): HumanizerErc7730Row[] | null => {
  return fields.reduce<HumanizerErc7730Row[] | null>((acc, field) => {
    if (!acc) return null

    const rows = fieldToRows(field, context, base)
    if (!rows) return null

    acc.push(...rows)
    return acc
  }, [])
}

// Per the ERC-7730 spec's interpolation algorithm, each `{path}` placeholder
// must be resolved against the matching entry in the format's `fields` array
// (by path, after resolving `$ref`) so its declared `format`/`params` control
// how the value is rendered - not just the raw value. Only leaf fields are
// searched: interpolated intents may only reference always-visible paths, and
// those never live under a grouped/array `fields` sub-list.
const findInterpolationField = (
  fields: Erc7730Field[] | undefined,
  path: string,
  context: FormatContext
): Erc7730Field | null => {
  if (!fields) return null

  for (const field of fields) {
    const resolvedField = resolveFieldReference(field, context)
    if (resolvedField.path === path) return resolvedField
  }

  return null
}

// Builds the ERC-7730 `interpolatedIntent` title as structured parts. Every
// placeholder uses the same field formatter as its corresponding detail row.
// Interpolation is all-or-nothing: malformed templates, unresolved paths,
// fields that are not always visible, or missing formatters return null so the
// UI can fall back to the static `intent` and its rows. Also returns the field
// paths consumed by a placeholder, so the caller can exclude them from the
// detail rows shown alongside the interpolated intent (they'd otherwise repeat
// the same data twice).
const interpolateIntentParts = (
  template: string,
  fields: Erc7730Field[] | undefined,
  context: FormatContext,
  base: unknown
): { parts: HumanizerVisualization[]; usedFieldPaths: Set<string> } | null => {
  const parts: HumanizerVisualization[] = []
  const usedFieldPaths = new Set<string>()
  let currentIndex = 0

  // The leading word(s) of an interpolated intent are the verb ("Swap ",
  // "Stake ", ...), so render them as an `action` part - same styling as the
  // rest of the app's action verbs (e.g. getAction('Swap') in the Uniswap/
  // CowSwap/etc. modules) - instead of plain text.
  // Literal text is buffered and flushed as one part per contiguous run between
  // placeholders (so an escaped brace stays part of the text around it), trimmed
  // so a part's content is the text itself and nothing else: the spacing the
  // template puts around a placeholder is layout, and the UI renders the parts
  // with a gap between them. Trimming also keeps a part comparable to a plain
  // string (e.g. `intent[0].content === 'Send'`), which a trailing space carried
  // over from the template would otherwise break.
  let textBuffer = ''

  const pushText = (text: string) => {
    textBuffer += text
  }

  const flushText = () => {
    const trimmedText = textBuffer.trim()
    textBuffer = ''
    if (!trimmedText) return
    parts.push(parts.length === 0 ? getAction(trimmedText) : getText(trimmedText))
  }

  while (currentIndex < template.length) {
    const openingBraceIndex = template.indexOf('{', currentIndex)
    const closingBraceIndex = template.indexOf('}', currentIndex)
    const nextBraceIndex =
      openingBraceIndex === -1
        ? closingBraceIndex
        : closingBraceIndex === -1
          ? openingBraceIndex
          : Math.min(openingBraceIndex, closingBraceIndex)

    if (nextBraceIndex === -1) {
      pushText(template.slice(currentIndex))
      break
    }

    pushText(template.slice(currentIndex, nextBraceIndex))

    const brace = template.charAt(nextBraceIndex)
    const isEscapedBrace = template.charAt(nextBraceIndex + 1) === brace
    if (isEscapedBrace) {
      pushText(brace)
      currentIndex = nextBraceIndex + 2
      continue
    }

    if (brace === '}') return null

    const placeholderEndIndex = template.indexOf('}', nextBraceIndex + 1)
    if (placeholderEndIndex === -1) return null

    const path = template.slice(nextBraceIndex + 1, placeholderEndIndex).trim()
    if (!path || path.includes('{')) return null

    const matchingField = findInterpolationField(fields, path, context)
    if (
      !matchingField ||
      (matchingField.visible !== undefined && matchingField.visible !== 'always') ||
      matchingField.fields?.length ||
      matchingField.format === 'calldata'
    ) {
      return null
    }

    const value = resolvePath(path, context, base)
    if (value === undefined) return null

    const formattedValue = formatFieldValue(matchingField, value, context, base)
    if (!formattedValue.length) return null
    if (
      (matchingField.format === 'amount' || matchingField.format === 'tokenAmount') &&
      !formattedValue.some((item) => item.type === 'token')
    ) {
      return null
    }
    if (
      (matchingField.format === 'addressName' ||
        matchingField.format === 'interoperableAddressName') &&
      !formattedValue.some((item) => item.type === 'address')
    ) {
      return null
    }
    flushText()
    parts.push(...formattedValue)
    usedFieldPaths.add(path)

    currentIndex = placeholderEndIndex + 1
  }

  flushText()

  return parts.length ? { parts, usedFieldPaths } : null
}

const formatToVisualizations = (
  format: Erc7730DisplayFormat,
  context: FormatContext,
  dapp?: Call['dapp']
): HumanizerVisualization[] | null => {
  const interpolation = format.interpolatedIntent
    ? interpolateIntentParts(format.interpolatedIntent, format.fields, context, context.root)
    : null
  // `format.intent` is the spec's plain, non-interpolated short title (e.g.
  // "Swap") - it needs no token/decimals lookup, so it can never fail the way
  // interpolation can, and is the fallback `intent` (as `[action]`) whenever
  // there's no `interpolatedIntent` or interpolation couldn't be resolved.
  const rows = fieldsToRows(format.fields || [], context, context.root)
  if (!rows) return null

  return [
    getErc7730Visualization(
      format.intent,
      rows,
      dapp,
      interpolation
        ? { parts: interpolation.parts, usedFieldPaths: [...interpolation.usedFieldPaths] }
        : undefined
    )
  ]
}

const isOneInchFillOrderFormat = (formatKey: string, descriptorPath?: string) =>
  !!descriptorPath?.includes('registry/1inch/') && formatKey.startsWith('fillOrder(')

const hasResolvableTokenReference = (field: Erc7730Field, context: FormatContext): boolean => {
  const resolvedField = resolveFieldReference(field, context)
  const tokenPath =
    typeof resolvedField.params?.tokenPath === 'string'
      ? resolvePath(resolvedField.params.tokenPath, context, context.root)
      : undefined
  const token = resolveParamValue(resolvedField.params?.token, context, context.root)
  const tokenReference = tokenPath ?? token

  return (
    typeof tokenReference === 'bigint' ||
    (typeof tokenReference === 'string' && isAddress(tokenReference))
  )
}

// Applies a structural edit (stripping a row, appending one, replacing one) to `fields` - the only
// stored row array. The displayed rows are derived from `fields` elsewhere, so they stay in sync
// automatically.
const updateErc7730Rows = (
  visualization: HumanizerVisualization & HumanizerErc7730Visualization,
  transform: (rows: HumanizerErc7730Row[]) => HumanizerErc7730Row[]
): HumanizerVisualization & HumanizerErc7730Visualization => ({
  ...visualization,
  fields: transform(visualization.fields)
})

const hideOneInchMinimumReceiveWithoutToken = (
  match: DescriptorFormatMatch,
  context: FormatContext,
  fullVisualization: HumanizerVisualization[]
): HumanizerVisualization[] => {
  if (!context.descriptorPath?.includes('registry/1inch/')) return fullVisualization

  const minimumReceiveField = match.format.fields
    ?.map((field) => resolveFieldReference(field, context))
    .find(
      (field) =>
        field.format === 'tokenAmount' &&
        (field.label || field.path || '').trim().toLowerCase() === 'minimum to receive'
    )

  if (!minimumReceiveField || hasResolvableTokenReference(minimumReceiveField, context)) {
    return fullVisualization
  }

  return fullVisualization.map((visualization) =>
    visualization.type === 'erc7730'
      ? updateErc7730Rows(visualization, (rows) =>
          rows.filter(
            (row) => getErc7730RowLabel(row).trim().toLowerCase() !== 'minimum to receive'
          )
        )
      : visualization
  )
}

const getUintAddressValue = (value: unknown): string | null => {
  if (typeof value === 'bigint') return uintToAddress(value)
  if (typeof value === 'string' && isAddress(value)) return value

  return null
}

const getOneInchFillOrderSwapVisualization = (
  match: DescriptorFormatMatch,
  context: FormatContext,
  fullVisualization: HumanizerVisualization[],
  dapp?: Call['dapp']
): HumanizerVisualization[] | null => {
  if (!isOneInchFillOrderFormat(match.formatKey, context.descriptorPath)) return fullVisualization

  const order = match.values.order
  if (!isPlainObject(order)) return fullVisualization

  const maker = getUintAddressValue(order.maker)
  const makerAsset = getUintAddressValue(order.makerAsset)
  const takerAsset = getUintAddressValue(order.takerAsset)
  const makingAmount = toBigIntOrNull(order.makingAmount)
  const takingAmount = toBigIntOrNull(order.takingAmount)

  if (!maker || !makerAsset || !takerAsset || makingAmount === null || takingAmount === null) {
    return fullVisualization
  }

  const metadata = context.root['@']
  const accountAddr = isPlainObject(metadata) ? metadata.accountAddr : undefined
  const isMakerAccount =
    typeof accountAddr === 'string' && maker.toLowerCase() === accountAddr.toLowerCase()
  const outgoingToken = isMakerAccount ? makerAsset : takerAsset
  const outgoingAmount = isMakerAccount ? makingAmount : toBigIntOrNull(match.values.amount)
  const incomingToken = isMakerAccount ? takerAsset : makerAsset
  const incomingAmount = isMakerAccount ? takingAmount : makingAmount

  if (outgoingAmount === null) return fullVisualization

  const oneInchVisualization = fullVisualization.find(
    (visualization): visualization is HumanizerVisualization & HumanizerErc7730Visualization =>
      visualization.type === 'erc7730'
  )
  const additionalRows =
    oneInchVisualization?.fields.filter(
      (row) => !getErc7730RowValues(row).some((value) => value.type === 'token')
    ) || []

  return [
    getErc7730Visualization(
      oneInchVisualization?.intent[0]?.content || 'Fill order',
      [
        {
          type: 'single-value',
          label: 'Amount to Send',
          value: getToken(outgoingToken, outgoingAmount, context.chainId)
        },
        {
          type: 'single-value',
          label: 'Minimum to Receive',
          value: getToken(incomingToken, incomingAmount, context.chainId)
        },
        ...additionalRows
      ],
      dapp
    )
  ]
}

// A legacy module describes a call as one flat run of parts, starting with the action verb. That
// run is what a `call` row renders, kept exactly as the module built it - `break`s included, since
// they are where the module wanted the line to end.
const getFlatCallValue = (
  visualizations: HumanizerVisualization[] | undefined
): HumanizerVisualization[] | null => {
  if (!visualizations?.some((visualization) => visualization.type === 'action')) return null

  return visualizations.length ? visualizations : null
}

// The flat parts a nested call gets when no ERC-7730 descriptor describes it: the legacy humanizer
// modules run over it and their own wording is handed back untouched, for a `call` row to render.
const getModuleFallbackValue = (
  call: Call,
  chainId: bigint,
  accountAddr: string,
  collectedWarnings?: HumanizerWarning[]
): HumanizerVisualization[] | null => {
  const accountOp = {
    accountAddr,
    chainId,
    calls: [call]
  } as AccountOp

  const humanizedCall = humanizeCallWithModules(accountOp, call as IrCall)

  const value = getFlatCallValue(humanizedCall?.fullVisualization)
  if (!value) return null

  const resetText = getSetAllowanceResetText(call as IrCall)
  const valueWithReset =
    resetText && value.some((item) => item.type === 'token')
      ? [...value, getText(resetText, true)]
      : value

  // The modules above already found everything worth warning about in this nested call, but only
  // its visualization becomes a row. Hand the warnings to the caller so they reach the top level.
  collectedWarnings?.push(...(humanizedCall?.warnings || []))

  return valueWithReset
}

const hasDisplayedNativeTransactionValue = (
  fullVisualization: HumanizerVisualization[],
  nativeValue: bigint
) =>
  flattenHumanizerVisualizations(fullVisualization).some(
    (visualization) =>
      visualization.type === 'token' &&
      visualization.address.toLowerCase() === ZeroAddress &&
      visualization.value === nativeValue
  )

const appendNativeValueRow = (
  fullVisualization: HumanizerVisualization[],
  nativeValue: bigint,
  chainId: bigint
): { fullVisualization: HumanizerVisualization[]; didAppendNativeValueRow: boolean } => {
  if (nativeValue === 0n) return { fullVisualization, didAppendNativeValueRow: false }
  if (hasDisplayedNativeTransactionValue(fullVisualization, nativeValue)) {
    return { fullVisualization, didAppendNativeValueRow: false }
  }

  let didFindErc7730Visualization = false

  const visualizationWithNativeValue = fullVisualization.map((visualization) => {
    if (didFindErc7730Visualization || visualization.type !== 'erc7730') return visualization

    didFindErc7730Visualization = true
    return updateErc7730Rows(visualization, (rows) => [
      ...rows,
      {
        type: 'single-value',
        label: 'Send',
        value: getToken(ZeroAddress, nativeValue, chainId)
      }
    ])
  })

  return {
    fullVisualization: visualizationWithNativeValue,
    didAppendNativeValueRow: didFindErc7730Visualization
  }
}

const getNativeValueWarnings = (
  didAppendNativeValueRow: boolean,
  nativeAssetSymbol?: string
): HumanizerWarning[] => {
  if (!nativeAssetSymbol) return []
  return didAppendNativeValueRow
    ? [
        getWarning(
          `This transaction will send ${nativeAssetSymbol}`,
          'ERC7730_REQUIRES_NATIVE_VALUE'
        )
      ]
    : []
}

// The humanizer decodes all the levels of calls embedded in other calls, but only the
// first MAX_DISPLAYED_NESTED_CALLDATA_DEPTH levels are shown in the UI. A transaction
// nested that deep is unusual, so the user is warned about it.
const getNestedErc7730Depth = (visualization: HumanizerErc7730Visualization): number => {
  const nestedDepths = visualization.fields.flatMap((row) =>
    getErc7730RowValues(row)
      .filter(
        (value): value is HumanizerVisualization & HumanizerErc7730Visualization =>
          value.type === 'erc7730'
      )
      .map((nestedVisualization) => 1 + getNestedErc7730Depth(nestedVisualization))
  )

  return nestedDepths.length ? Math.max(...nestedDepths) : 0
}

const getNestedCalldataDepthWarnings = (
  fullVisualization: HumanizerVisualization[]
): HumanizerWarning[] => {
  const depths = fullVisualization
    .filter(
      (visualization): visualization is HumanizerVisualization & HumanizerErc7730Visualization =>
        visualization.type === 'erc7730'
    )
    .map((visualization) => getNestedErc7730Depth(visualization))

  if (!depths.length || Math.max(...depths) < MAX_DISPLAYED_NESTED_CALLDATA_DEPTH) return []

  return [
    getWarning(
      'This transaction hides many other transactions one inside another. This is unusual - continue only if you fully trust this app.',
      'ERC7730_SUSPICIOUS_NESTED_CALLDATA_DEPTH'
    )
  ]
}

const getSafeCallWarnings = (call: Call, safeAddr = call.to): HumanizerWarning[] => {
  return getSafeHumanization(safeAddr, call.to, call.value, call.data)?.warnings || []
}

const getSafeTxMessageWarnings = (message: Message): HumanizerWarning[] => {
  if (message.content.kind !== 'typedMessage') return []
  if (message.content.primaryType !== SAFE_TX_PRIMARY_TYPE) return []

  const warnings: HumanizerWarning[] = []
  const { to, operation } = message.content.message
  const bigintOperation = toBigIntOrNull(operation ?? 0)

  if (bigintOperation !== null && typeof to === 'string') {
    warnings.push(...getDelegateCallWarning(bigintOperation, to))
  }

  const safeTxCalls = getSafeTxCallsFromMessage(message) || []
  safeTxCalls.forEach((safeTxCall) => warnings.push(...getSafeCallWarnings(safeTxCall)))

  return dedupeWarnings(warnings)
}

// One `call` row per call a Safe transaction authorises: the nested visualization when that call
// has an ERC-7730 descriptor of its own, otherwise the flat parts a legacy module produced for it.
const getInnerCallRows = (
  innerCalls: Call[],
  chainId: bigint,
  accountAddr: string,
  resolvedDescriptor: Erc7730ResolvedDescriptor,
  collectedWarnings?: HumanizerWarning[]
): HumanizerErc7730Row[] => {
  return innerCalls
    .map((innerCall, index): HumanizerVisualization[] | null => {
      const innerCallDescriptor = resolvedDescriptor.innerCallDescriptors?.[index]

      if (innerCallDescriptor) {
        const humanizedCall = humanizeCallWithErc7730(
          innerCall,
          chainId,
          accountAddr,
          innerCallDescriptor
        )
        const erc7730Visualization = humanizedCall?.fullVisualization?.find(
          (visualization) => visualization.type === 'erc7730'
        )
        if (erc7730Visualization) {
          collectedWarnings?.push(...(humanizedCall?.warnings || []))

          return [erc7730Visualization]
        }
      }

      // No `modules` argument, so this runs the whole module pipeline, which ends in
      // `fallbackHumanizer` - it describes any call with a `to`, down to "Interacting with", and
      // already reads the known-selector names. Nothing is left for a further fallback to add.
      return getModuleFallbackValue(innerCall, chainId, accountAddr, collectedWarnings)
    })
    .filter((value): value is HumanizerVisualization[] => !!value)
    .map((value) => ({ type: 'call', value }))
}

const getSafeTxCallRows = (
  message: Message,
  chainId: bigint,
  resolvedDescriptor: Erc7730ResolvedDescriptor
): HumanizerErc7730Row[] | null => {
  // Covers a plain `call` too - it reads as a batch of exactly one - so there is no separate
  // single-call path to keep in step with this one.
  const safeTxCalls = getSafeTxCallsFromMessage(message)
  if (!safeTxCalls?.length) return null

  const innerCallRows = getInnerCallRows(
    safeTxCalls,
    chainId,
    message.accountAddr,
    resolvedDescriptor
  )

  return innerCallRows.length ? innerCallRows : null
}

const replaceSafeTxTransactionRow = (
  fullVisualization: HumanizerVisualization[],
  message: Message,
  chainId: bigint,
  resolvedDescriptor: Erc7730ResolvedDescriptor
): HumanizerVisualization[] => {
  const safeTxCallRows = getSafeTxCallRows(message, chainId, resolvedDescriptor)
  if (!safeTxCallRows) return fullVisualization

  // Computed independently per row list below (not shared), since the placeholder row could in
  // principle be present in one list but not the other.
  const replaceTransactionRow = (rows: HumanizerErc7730Row[]) => {
    let didReplaceTransactionRow = false
    const nextRows = rows.flatMap((row) => {
      // `data` is the only `calldata` field a SafeTx format has, so its row is the placeholder the
      // decoded inner calls replace - and any further one is that same undecoded blob again.
      if (row.type !== 'call') return [row]
      if (didReplaceTransactionRow) return []

      didReplaceTransactionRow = true
      return safeTxCallRows
    })

    return didReplaceTransactionRow ? nextRows : [...nextRows, ...safeTxCallRows]
  }

  return fullVisualization.map((visualization) =>
    visualization.type === 'erc7730'
      ? updateErc7730Rows(visualization, replaceTransactionRow)
      : visualization
  )
}

export const humanizeCallWithErc7730 = (
  call: Call,
  chainId: bigint,
  accountAddr: string,
  resolvedDescriptor: Erc7730ResolvedDescriptor,
  nativeAssetSymbol?: string,
  /**
   * Set only by the registry, which runs the formatting to find out which calls are embedded in
   * this one so it can fetch a descriptor for each of them.
   */
  collectedNestedCalls?: Call[]
): IrCall | null => {
  if (resolvedDescriptor.innerCalls?.length) {
    const collectedWarnings: HumanizerWarning[] = []
    const innerCallRows = getInnerCallRows(
      resolvedDescriptor.innerCalls,
      chainId,
      accountAddr,
      resolvedDescriptor,
      collectedWarnings
    )

    if (!innerCallRows.length || !call.to) return null

    return {
      ...call,
      fullVisualization: [
        getErc7730Visualization('Execute a Safe{Wallet} Transaction', [
          {
            type: 'single-value',
            label: 'Safe',
            value: getAddressVisualization(call.to)
          },
          ...innerCallRows
        ])
      ],
      warnings: dedupeWarnings([
        ...resolvedDescriptor.innerCalls.flatMap((innerCall) => getSafeCallWarnings(innerCall)),
        ...collectedWarnings
      ])
    }
  }

  const match = getCalldataFormatMatch(call, resolvedDescriptor.descriptor)
  if (!match) return null

  const context: FormatContext = {
    descriptor: resolvedDescriptor.descriptor,
    descriptorPath: resolvedDescriptor.path,
    root: {
      ...match.values,
      '@': {
        accountAddr,
        from: accountAddr,
        to: call.to,
        value: call.value,
        data: call.data,
        chainId
      }
    },
    chainId,
    collectedWarnings: [],
    nestedCallDescriptors: resolvedDescriptor.nestedCallDescriptors,
    collectedNestedCalls
  }
  const fullVisualization = formatToVisualizations(match.format, context, call.dapp)
  const normalizedVisualization = fullVisualization
    ? getOneInchFillOrderSwapVisualization(match, context, fullVisualization, call.dapp)
    : null
  const oneInchVisualization = normalizedVisualization
    ? hideOneInchMinimumReceiveWithoutToken(match, context, normalizedVisualization)
    : null
  const visualizationWithNativeValue = oneInchVisualization
    ? appendNativeValueRow(oneInchVisualization, call.value, chainId)
    : null

  return visualizationWithNativeValue?.fullVisualization.length
    ? {
        ...call,
        fullVisualization: visualizationWithNativeValue.fullVisualization,
        warnings: dedupeWarnings([
          ...getSafeCallWarnings(call, accountAddr),
          ...getSafeExecTransactionWarnings(match),
          ...getNativeValueWarnings(
            visualizationWithNativeValue.didAppendNativeValueRow,
            nativeAssetSymbol
          ),
          ...getNestedCalldataDepthWarnings(visualizationWithNativeValue.fullVisualization),
          // warnings the nested calls produced while this call was being formatted
          ...context.collectedWarnings
        ])
      }
    : null
}

export const humanizeMessageWithErc7730 = (
  message: Message,
  resolvedDescriptor: Erc7730ResolvedDescriptor
): IrMessage | null => {
  const match = getTypedMessageFormatMatch(message, resolvedDescriptor.descriptor)
  if (!match || message.content.kind !== 'typedMessage') return null

  const chainId =
    toBigIntOrNull(message.content.domain.chainId ?? message.chainId) ?? message.chainId
  const context: FormatContext = {
    descriptor: resolvedDescriptor.descriptor,
    descriptorPath: resolvedDescriptor.path,
    root: {
      ...match.values,
      '@': {
        accountAddr: message.accountAddr,
        chainId,
        domain: message.content.domain,
        to: message.content.domain.verifyingContract,
        verifyingContract: message.content.domain.verifyingContract
      }
    },
    chainId,
    collectedWarnings: []
  }
  const fullVisualization = formatToVisualizations(match.format, context)
  const safeTxVisualization =
    fullVisualization && message.content.primaryType === SAFE_TX_PRIMARY_TYPE
      ? replaceSafeTxTransactionRow(fullVisualization, message, chainId, resolvedDescriptor)
      : fullVisualization

  return safeTxVisualization?.length
    ? {
        ...message,
        fullVisualization: safeTxVisualization,
        warnings: dedupeWarnings([
          ...getSafeTxMessageWarnings(message),
          // warnings the calls nested in this message produced while it was being formatted
          ...context.collectedWarnings
        ]),
        canHideDropdownArrow: true
      }
    : null
}
