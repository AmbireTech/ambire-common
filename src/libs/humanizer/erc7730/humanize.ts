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

import humanizerInfo from '../../../consts/humanizer/humanizerInfo.json'
import { Message } from '../../../interfaces/userRequest'
import { AccountOp } from '../../accountOp/accountOp'
import { Call } from '../../accountOp/types'
import {
  HumanizerCallModule,
  HumanizerErc7730Row,
  HumanizerErc7730Visualization,
  HumanizerMeta,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall,
  IrMessage
} from '../interfaces'
import { aaveHumanizer } from '../modules/Aave'
import AllowanceModule, { getSetAllowanceResetText } from '../modules/Allowance'
import { decodeGeneralAdapterCall } from '../modules/Bundler3/generalAdapter'
import { getDelegateCallWarning, getSafeHumanization } from '../modules/Safe'
import { genericErc20Humanizer } from '../modules/Tokens'
import {
  eToNative,
  getAddressVisualization,
  getChain,
  getErc7730Visualization,
  getText,
  getToken,
  getWarning,
  flattenHumanizerVisualizations,
  uintToAddress
} from '../utils'
import { SAFE_TX_PRIMARY_TYPE } from './consts'
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
import { getSafeTxCallsFromMessage, isPlainObject, parseIntegerLiteral } from './utils'

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
  nestedCalldataDepth?: number
}

type VisibilityResult = {
  visible: boolean
  valid: boolean
}

const MAX_INTERPOLATED_VALUE_LENGTH = 80
const MAX_NESTED_CALLDATA_DEPTH = 4
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

const interpolatedValueToText = (path: string, value: unknown): string => {
  const amount = toBigIntOrNull(value)
  if ((path === '@.value' || path === '#.@.value') && amount !== null) {
    return formatUnits(amount, 18)
  }

  return valueToText(value)
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

const getFieldValue = (field: Erc7730Field, context: FormatContext, base: unknown): unknown =>
  field.value !== undefined ? field.value : resolvePath(field.path, context, base)

const getArrayValueAt = (value: unknown, index: number): unknown =>
  Array.isArray(value) ? value[index] : value

const getMorphoGeneralAdapterCalldataValue = (
  context: FormatContext,
  calldata: unknown,
  callee: unknown,
  amount: unknown
): HumanizerVisualization[] | null => {
  if (!context.descriptorPath?.includes('registry/morpho/calldata-MorphoBundlerV3.json'))
    return null
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
  if ((context.nestedCalldataDepth || 0) >= MAX_NESTED_CALLDATA_DEPTH) return null
  if (typeof calldata !== 'string' || !calldata.startsWith('0x') || calldata.length < 10)
    return null
  if (typeof callee !== 'string' || !isAddress(callee)) return null
  if (!context.chainId) return null

  const accountAddr = resolvePath('#.@.accountAddr', context, context.root)
  if (typeof accountAddr !== 'string' || !isAddress(accountAddr)) return null

  const humanizedCall = humanizeCallWithErc7730(
    {
      to: callee,
      data: calldata,
      value: toBigIntOrNull(amount) || 0n
    },
    context.chainId,
    accountAddr,
    { descriptor: context.descriptor, path: context.descriptorPath },
    (context.nestedCalldataDepth || 0) + 1
  )
  const erc7730Visualization = humanizedCall?.fullVisualization?.find(
    (visualization) => visualization.type === 'erc7730'
  )

  return erc7730Visualization?.type === 'erc7730' ? erc7730Visualization : null
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
  const nestedRowLabel =
    field.label?.trim().toLowerCase() === 'call' ? '' : (field.label ?? field.path ?? '')

  return values.reduce<HumanizerErc7730Row[] | null>((acc, calldata, index) => {
    if (!acc) return null

    const rowValue: HumanizerVisualization[] = []
    const callee = getArrayValueAt(calleeValues, index)
    const selector = getArrayValueAt(selectorValues, index)
    const amount = getArrayValueAt(amountValues, index)
    const decodedValue = getMorphoGeneralAdapterCalldataValue(context, calldata, callee, amount)

    if (decodedValue) {
      acc.push({
        label: field.label || field.path || '',
        value: decodedValue
      })

      return acc
    }

    const nestedVisualization = getNestedErc7730CalldataValue(context, calldata, callee, amount)
    if (nestedVisualization) {
      acc.push({
        label: nestedRowLabel,
        value: [nestedVisualization]
      })

      return acc
    }

    if (
      typeof calldata === 'string' &&
      typeof callee === 'string' &&
      isAddress(callee) &&
      typeof accountAddr === 'string' &&
      context.chainId
    ) {
      const safeFallbackVisualization = getSafeCallFallbackVisualization({
        to: callee,
        data: calldata,
        value: toBigIntOrNull(amount) || 0n
      })

      if (safeFallbackVisualization) {
        acc.push({
          label: nestedRowLabel,
          value: [safeFallbackVisualization]
        })

        return acc
      }

      const moduleFallbackVisualization = getModuleFallbackVisualization(
        {
          to: callee,
          data: calldata,
          value: toBigIntOrNull(amount) || 0n
        },
        context.chainId,
        accountAddr
      )

      if (moduleFallbackVisualization) {
        acc.push({
          label: nestedRowLabel,
          value: [moduleFallbackVisualization]
        })

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

    acc.push({
      label: field.label || field.path || '',
      value: rowValue
    })

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

const fieldToRows = (
  field: Erc7730Field,
  context: FormatContext,
  base: unknown
): HumanizerErc7730Row[] | null => {
  const resolvedField = resolveFieldReference(field, context)
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

  return [
    {
      label: resolvedField.label || resolvedField.path || '',
      value: formatFieldValue(resolvedField, value, context, base)
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

const interpolateIntent = (
  template: string,
  context: FormatContext,
  base: unknown
): string | null => {
  let interpolated = ''
  let currentIndex = 0

  while (currentIndex < template.length) {
    const openingBraceIndex = template.indexOf('{', currentIndex)
    if (openingBraceIndex === -1) {
      interpolated += template.slice(currentIndex)
      break
    }

    const closingBraceIndex = template.indexOf('}', openingBraceIndex + 1)
    if (closingBraceIndex === -1) {
      interpolated += template.slice(currentIndex)
      break
    }

    interpolated += template.slice(currentIndex, openingBraceIndex)

    const path = template.slice(openingBraceIndex + 1, closingBraceIndex).trim()
    const value = resolvePath(path, context, base)
    if (value === undefined) return null

    interpolated += interpolatedValueToText(path, value)
    currentIndex = closingBraceIndex + 1
  }

  return interpolated
}

const formatToVisualizations = (
  format: Erc7730DisplayFormat,
  context: FormatContext,
  dapp?: Call['dapp']
): HumanizerVisualization[] | null => {
  const intent =
    (format.interpolatedIntent &&
      interpolateIntent(format.interpolatedIntent, context, context.root)) ||
    format.intent
  const rows = fieldsToRows(format.fields || [], context, context.root)
  if (!rows) return null

  return [getErc7730Visualization(intent, rows, dapp)]
}

const isOneInchFillOrderFormat = (formatKey: string, descriptorPath?: string) =>
  !!descriptorPath?.includes('registry/1inch/') && formatKey.startsWith('fillOrder(')

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
    oneInchVisualization?.rows.filter(
      (row) => !row.value.some((value) => value.type === 'token')
    ) || []

  return [
    getErc7730Visualization(
      oneInchVisualization?.title || 'Fill order',
      [
        {
          label: 'Amount to Send',
          value: [getToken(outgoingToken, outgoingAmount, context.chainId)]
        },
        {
          label: 'Minimum to Receive',
          value: [getToken(incomingToken, incomingAmount, context.chainId)]
        },
        ...additionalRows
      ],
      dapp
    )
  ]
}

const getSafeTxCallFromMessage = (message: Message): Call | null => {
  if (message.content.kind !== 'typedMessage') return null
  if (message.content.primaryType !== SAFE_TX_PRIMARY_TYPE) return null

  const { to, value, data, operation } = message.content.message
  if (toBigIntOrNull(operation ?? 0) !== 0n) return null
  if (typeof to !== 'string' || !isAddress(to)) return null
  if (typeof data !== 'string' || !isHexString(data)) return null

  const bigintValue = toBigIntOrNull(value ?? 0)
  if (bigintValue === null) return null

  return {
    to,
    data,
    value: bigintValue
  }
}

const getKnownFunctionName = (call: Call): string | null => {
  const selector = call.data?.slice(0, 10).toLowerCase()
  if (!selector) return null

  const matchingFragment = Object.values((humanizerInfo as HumanizerMeta).abis)
    .map((abi) => abi[selector])
    .find((fragment) => fragment?.type === 'function')
  const signaturePrefix = 'function '
  const functionSignature = matchingFragment?.signature.startsWith(signaturePrefix)
    ? matchingFragment.signature.slice(signaturePrefix.length)
    : undefined
  const functionNameEnd = functionSignature?.indexOf('(') ?? -1
  const functionName =
    functionNameEnd >= 0 ? functionSignature?.slice(0, functionNameEnd).trim() : null

  return functionName || null
}

const capitalizeLabel = (value: string): string => {
  if (!value) return value

  return `${value[0]!.toUpperCase()}${value.slice(1)}`
}

const getRowsFromErc7730CallVisualization = (
  visualization: HumanizerVisualization & HumanizerErc7730Visualization
): HumanizerErc7730Row[] | null => {
  const [firstRow, ...additionalRows] = visualization.rows
  if (!firstRow) return null

  return [
    {
      label: visualization.title || firstRow.label,
      value: firstRow.value
    },
    ...additionalRows
  ]
}

const getRowsFromFlatCallVisualization = (
  visualizations: HumanizerVisualization[] | undefined
): HumanizerErc7730Row[] | null => {
  const firstActionIndex =
    visualizations?.findIndex((visualization) => visualization.type === 'action') ?? -1
  if (!visualizations || firstActionIndex < 0) return null

  const action = visualizations[firstActionIndex]
  if (!action || action.type !== 'action' || !action.content) return null

  const rows: HumanizerErc7730Row[] = [{ label: action.content, value: [] }]
  let currentRow = rows[0]!

  visualizations.slice(firstActionIndex + 1).forEach((visualization) => {
    if (visualization.type === 'break') return

    if (visualization.type === 'label' && visualization.content) {
      currentRow = { label: capitalizeLabel(visualization.content), value: [] }
      rows.push(currentRow)
      return
    }

    currentRow.value.push(visualization)
  })

  const rowsWithValues = rows.filter((row) => row.value.length)

  return rowsWithValues.length ? rowsWithValues : null
}

const getActionTitleFromFlatCallVisualization = (
  visualizations: HumanizerVisualization[] | undefined
): string | null => {
  const action = visualizations?.find((visualization) => visualization.type === 'action')

  return action?.type === 'action' ? action.content || null : null
}

const getKnownCallVisualization = (
  call: Call
): (HumanizerVisualization & HumanizerErc7730Visualization) | null => {
  const functionName = getKnownFunctionName(call)
  if (!functionName || !call.to) return null

  const visualization = getErc7730Visualization(functionName, [
    {
      label: 'Contract',
      value: [getAddressVisualization(call.to)]
    }
  ])

  return visualization.type === 'erc7730' ? visualization : null
}

const getSafeCallFallbackVisualization = (
  call: Call
): (HumanizerVisualization & HumanizerErc7730Visualization) | null => {
  const safeHumanization = getSafeHumanization(call.to, call.to, call.value, call.data)
  const action = safeHumanization?.visuals?.find((visualization) => visualization.type === 'action')
  if (!safeHumanization?.visuals || !action || action.type !== 'action' || !action.content) {
    return null
  }

  if (action.content === 'Account setup') {
    const rows = getRowsFromFlatCallVisualization(safeHumanization.visuals)
    if (!rows) return null

    const visualization = getErc7730Visualization(action.content, rows)

    return visualization.type === 'erc7730' ? visualization : null
  }

  const firstActionIndex = safeHumanization.visuals.indexOf(action)
  const value = safeHumanization.visuals
    .slice(firstActionIndex + 1)
    .filter((visualization) => visualization.type !== 'break')
    .map((visualization) =>
      visualization.content !== undefined && typeof visualization.content !== 'string'
        ? { ...visualization, content: String(visualization.content) }
        : visualization
    )
  const rows: HumanizerErc7730Row[] = [
    {
      label: action.content,
      value: value.length || !call.to ? value : [getAddressVisualization(call.to)]
    }
  ]
  if (!rows.length) return null

  const visualization = getErc7730Visualization(action.content, rows)

  return visualization.type === 'erc7730' ? visualization : null
}

const getModuleFallbackVisualization = (
  call: Call,
  chainId: bigint,
  accountAddr: string
): (HumanizerVisualization & HumanizerErc7730Visualization) | null => {
  const accountOp = {
    accountAddr,
    chainId,
    calls: [call]
  } as AccountOp
  const localFallbackModules: HumanizerCallModule[] = [aaveHumanizer, AllowanceModule]
  let humanizedCall: IrCall | undefined

  localFallbackModules.some((module) => {
    try {
      const [result] = module(accountOp, [call as IrCall])
      if (!result?.fullVisualization?.length) return false

      humanizedCall = result
      return true
    } catch (error) {
      console.error(error)
      return false
    }
  })

  if (!humanizedCall?.fullVisualization?.length) {
    const [fallbackCall] = genericErc20Humanizer({ accountAddr }, [call as IrCall])
    humanizedCall = fallbackCall
  }

  const rows = getRowsFromFlatCallVisualization(humanizedCall?.fullVisualization)
  if (!rows) return null

  const resetText = getSetAllowanceResetText(call as IrCall)
  const rowsWithReset = resetText
    ? rows.map((row) =>
        row.value.some((value) => value.type === 'token')
          ? {
              ...row,
              value: [...row.value, getText(resetText, true)]
            }
          : row
      )
    : rows

  const visualization = getErc7730Visualization(
    getActionTitleFromFlatCallVisualization(humanizedCall?.fullVisualization) ||
      rowsWithReset[0]!.label,
    rowsWithReset
  )

  return visualization.type === 'erc7730' ? visualization : null
}

const dedupeWarnings = (warnings: HumanizerWarning[]): HumanizerWarning[] => {
  const warningKeys = new Set<string>()

  return warnings.filter((warning) => {
    const warningKey = `${warning.code}:${warning.content}`
    if (warningKeys.has(warningKey)) return false
    warningKeys.add(warningKey)

    return true
  })
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
): HumanizerVisualization[] => {
  if (nativeValue === 0n) return fullVisualization
  if (hasDisplayedNativeTransactionValue(fullVisualization, nativeValue)) return fullVisualization

  let didFindErc7730Visualization = false

  return fullVisualization.map((visualization) => {
    if (didFindErc7730Visualization || visualization.type !== 'erc7730') return visualization

    didFindErc7730Visualization = true
    return {
      ...visualization,
      rows: [
        ...visualization.rows,
        {
          label: 'Send',
          value: [getToken(ZeroAddress, nativeValue, chainId)]
        }
      ]
    }
  })
}

const getNativeValueWarnings = (
  fullVisualization: HumanizerVisualization[],
  nativeAssetSymbol?: string
): HumanizerWarning[] => {
  if (!nativeAssetSymbol) return []

  const hasNativeValue = fullVisualization.some(
    (visualization) =>
      visualization.type === 'erc7730' &&
      visualization.rows.some(
        (row) =>
          row.label === 'Send' &&
          row.value.some(
            (value) =>
              value.type === 'token' &&
              value.address === ZeroAddress &&
              value.value !== undefined &&
              value.value > 0n
          )
      )
  )

  return hasNativeValue
    ? [
        getWarning(
          `This transaction will send ${nativeAssetSymbol}`,
          'ERC7730_REQUIRES_NATIVE_VALUE'
        )
      ]
    : []
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

const getSafeTxCallVisualizations = (
  safeTxCalls: Call[],
  chainId: bigint,
  accountAddr: string,
  resolvedDescriptor: Erc7730ResolvedDescriptor
): (HumanizerVisualization & HumanizerErc7730Visualization)[] => {
  return safeTxCalls
    .map((safeTxCall, index) => {
      const safeTxCallDescriptor =
        resolvedDescriptor.safeTxCallDescriptors?.[index] || resolvedDescriptor.safeTxCallDescriptor

      if (safeTxCallDescriptor) {
        const humanizedCall = humanizeCallWithErc7730(
          safeTxCall,
          chainId,
          accountAddr,
          safeTxCallDescriptor
        )
        const erc7730Visualization = humanizedCall?.fullVisualization?.find(
          (visualization) => visualization.type === 'erc7730'
        )
        if (erc7730Visualization) return erc7730Visualization
      }

      const safeFallbackVisualization = getSafeCallFallbackVisualization(safeTxCall)
      if (safeFallbackVisualization) return safeFallbackVisualization

      const moduleFallbackVisualization = getModuleFallbackVisualization(
        safeTxCall,
        chainId,
        accountAddr
      )
      if (moduleFallbackVisualization) return moduleFallbackVisualization

      const [fallbackCall] = genericErc20Humanizer({ accountAddr }, [safeTxCall])
      const rows = getRowsFromFlatCallVisualization(fallbackCall?.fullVisualization)
      if (!rows) return getKnownCallVisualization(safeTxCall)

      return getErc7730Visualization(
        getActionTitleFromFlatCallVisualization(fallbackCall?.fullVisualization) || rows[0]!.label,
        rows
      )
    })
    .filter(
      (visualization): visualization is HumanizerVisualization & HumanizerErc7730Visualization =>
        !!visualization && visualization.type === 'erc7730'
    )
}

const getSafeTxCallRows = (
  message: Message,
  chainId: bigint,
  resolvedDescriptor: Erc7730ResolvedDescriptor
): HumanizerErc7730Row[] | null => {
  const safeTxCalls = getSafeTxCallsFromMessage(message)
  if (!safeTxCalls?.length) return null

  const safeTxCallVisualizations = getSafeTxCallVisualizations(
    safeTxCalls,
    chainId,
    message.accountAddr,
    resolvedDescriptor
  )

  if (safeTxCallVisualizations.length) {
    return [
      {
        label: safeTxCallVisualizations.length === 1 ? 'Transaction' : 'Transactions',
        value: safeTxCallVisualizations
      }
    ]
  }

  const safeTxCall = getSafeTxCallFromMessage(message)
  if (!safeTxCall) return null
  if (resolvedDescriptor.safeTxCallDescriptor) {
    const humanizedCall = humanizeCallWithErc7730(
      safeTxCall,
      chainId,
      message.accountAddr,
      resolvedDescriptor.safeTxCallDescriptor
    )
    const erc7730Visualization = humanizedCall?.fullVisualization?.find(
      (visualization) => visualization.type === 'erc7730'
    )
    const rows = erc7730Visualization
      ? getRowsFromErc7730CallVisualization(erc7730Visualization)
      : null
    if (rows) return rows
  }

  const [fallbackCall] = genericErc20Humanizer({ accountAddr: message.accountAddr }, [safeTxCall])

  return getRowsFromFlatCallVisualization(fallbackCall?.fullVisualization)
}

const replaceSafeTxTransactionRow = (
  fullVisualization: HumanizerVisualization[],
  message: Message,
  chainId: bigint,
  resolvedDescriptor: Erc7730ResolvedDescriptor
): HumanizerVisualization[] => {
  const safeTxCallRows = getSafeTxCallRows(message, chainId, resolvedDescriptor)
  if (!safeTxCallRows) return fullVisualization

  return fullVisualization.map((visualization) => {
    if (visualization.type !== 'erc7730') return visualization

    let didReplaceTransactionRow = false
    const rows = visualization.rows.flatMap((row) => {
      if (row.label.trim().toLowerCase() !== 'transaction') return [row]

      didReplaceTransactionRow = true
      return safeTxCallRows
    })

    return {
      ...visualization,
      rows: didReplaceTransactionRow ? rows : [...rows, ...safeTxCallRows]
    }
  })
}

export const humanizeCallWithErc7730 = (
  call: Call,
  chainId: bigint,
  accountAddr: string,
  resolvedDescriptor: Erc7730ResolvedDescriptor,
  nestedCalldataDepth = 0,
  nativeAssetSymbol?: string
): IrCall | null => {
  if (resolvedDescriptor.safeTxTransactionsOnly && resolvedDescriptor.safeTxCalls?.length) {
    const safeTxCallVisualizations = getSafeTxCallVisualizations(
      resolvedDescriptor.safeTxCalls,
      chainId,
      accountAddr,
      resolvedDescriptor
    )

    if (!safeTxCallVisualizations.length) return null

    return {
      ...call,
      fullVisualization: [
        getErc7730Visualization('Execute a Safe{Wallet} Transaction', [
          {
            label: '',
            value: safeTxCallVisualizations
          }
        ])
      ],
      warnings: dedupeWarnings(
        resolvedDescriptor.safeTxCalls.flatMap((safeTxCall) => getSafeCallWarnings(safeTxCall))
      )
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
        to: call.to,
        value: call.value,
        data: call.data,
        chainId
      }
    },
    chainId,
    nestedCalldataDepth
  }
  const fullVisualization = formatToVisualizations(match.format, context, call.dapp)
  const normalizedVisualization = fullVisualization
    ? getOneInchFillOrderSwapVisualization(match, context, fullVisualization, call.dapp)
    : null
  const visualizationWithNativeValue = normalizedVisualization
    ? appendNativeValueRow(normalizedVisualization, call.value, chainId)
    : null

  return visualizationWithNativeValue?.length
    ? {
        ...call,
        fullVisualization: visualizationWithNativeValue,
        warnings: dedupeWarnings([
          ...getSafeCallWarnings(call, accountAddr),
          ...getNativeValueWarnings(visualizationWithNativeValue, nativeAssetSymbol)
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
    chainId
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
        warnings: getSafeTxMessageWarnings(message),
        canHideDropdownArrow: true
      }
    : null
}
