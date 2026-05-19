import {
  formatUnits,
  FunctionFragment,
  Interface,
  isAddress,
  MaxUint256,
  ParamType,
  ZeroAddress
} from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { Call } from '../../accountOp/types'
import { HumanizerErc7730Row, HumanizerVisualization, IrCall, IrMessage } from '../interfaces'
import {
  getAddressVisualization,
  getChain,
  getErc7730Visualization,
  getText,
  getToken
} from '../utils'
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

type DescriptorFormatMatch = {
  formatKey: string
  format: Erc7730DisplayFormat
  values: Record<string, unknown>
}

type FormatContext = {
  descriptor: Erc7730Descriptor
  root: Record<string, unknown>
  chainId?: bigint
}

type VisibilityResult = {
  visible: boolean
  valid: boolean
}

const MAX_INTERPOLATED_VALUE_LENGTH = 80

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isMapReference = (value: unknown): value is Erc7730MapReference =>
  isRecord(value) && typeof value.map === 'string' && typeof value.keyPath === 'string'

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

const getPathSegments = (path: string): string[] =>
  path.replace(/^\./, '').split('.').filter(Boolean)

const normalizeSegmentIndex = (index: number, length: number): number =>
  index < 0 ? length + index : index

const readBracketSegment = (source: unknown, segment: string): unknown => {
  const indexMatch = segment.match(/^\[(-?\d+)\]$/)
  if (indexMatch) {
    const index = Number(indexMatch[1])
    if (!Array.isArray(source) || !Number.isInteger(index)) return undefined

    return source[normalizeSegmentIndex(index, source.length)]
  }

  const sliceMatch = segment.match(/^\[(-?\d*)?:(-?\d*)?\]$/)
  if (sliceMatch) {
    if (typeof source !== 'string') return undefined

    const hex = source.startsWith('0x') ? source.slice(2) : source
    if (hex.length % 2 !== 0) return undefined

    const byteLength = hex.length / 2
    const start =
      sliceMatch[1] === undefined || sliceMatch[1] === ''
        ? 0
        : normalizeSegmentIndex(Number(sliceMatch[1]), byteLength)
    const end =
      sliceMatch[2] === undefined || sliceMatch[2] === ''
        ? byteLength
        : normalizeSegmentIndex(Number(sliceMatch[2]), byteLength)

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
      const value = isRecord(currentValue) ? currentValue[key] : undefined
      return Array.isArray(value) ? value : undefined
    }

    if (Array.isArray(currentValue)) {
      const index = Number(segment)
      return Number.isInteger(index) ? currentValue[index] : undefined
    }

    return isRecord(currentValue) ? currentValue[segment] : undefined
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

  if (!isRecord(map) || key === undefined || key === null) return undefined

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
      return null
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
  return hexValue.length >= 8 && /^f+$/i.test(hexValue)
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

const getTokenAddressFromField = (
  field: Erc7730Field,
  context: FormatContext,
  base: unknown
): string | null => {
  const tokenPath =
    typeof field.params?.tokenPath === 'string'
      ? resolvePath(field.params.tokenPath, context, base)
      : undefined
  const tokenParam = resolveParamValue(field.params?.token, context, base)
  const tokenAddress = tokenPath ?? tokenParam

  if (typeof tokenAddress !== 'string' || !isAddress(tokenAddress)) return null

  const nativeCurrencyAddress = field.params?.nativeCurrencyAddress
  const nativeAddresses = Array.isArray(nativeCurrencyAddress)
    ? nativeCurrencyAddress
    : [nativeCurrencyAddress]

  return nativeAddresses.some(
    (address) => typeof address === 'string' && address.toLowerCase() === tokenAddress.toLowerCase()
  )
    ? ZeroAddress
    : tokenAddress
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
  if (!isRecord(enumDefinition)) return null

  const values = isRecord(enumDefinition.values) ? enumDefinition.values : enumDefinition
  const enumValue = values[valueToText(value)]

  return typeof enumValue === 'string' ? enumValue : null
}

const formatFieldValue = (
  field: Erc7730Field,
  value: unknown,
  context: FormatContext,
  base: unknown
): HumanizerVisualization[] => {
  if (field.format === 'addressName' || field.format === 'interoperableAddressName') {
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

const resolveFieldReference = (field: Erc7730Field, context: FormatContext): Erc7730Field => {
  if (!field.$ref) return field

  const referencedField = resolvePath(field.$ref, context, context.root)
  if (!isRecord(referencedField)) return field

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
  let didFail = false
  const interpolated = template.replace(/\{([^}]+)\}/g, (_, path: string) => {
    const value = resolvePath(path.trim(), context, base)
    if (value === undefined) {
      didFail = true
      return ''
    }

    return valueToText(value)
  })

  return didFail ? null : interpolated
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

export const humanizeCallWithErc7730 = (
  call: Call,
  chainId: bigint,
  resolvedDescriptor: Erc7730ResolvedDescriptor
): IrCall | null => {
  const match = getCalldataFormatMatch(call, resolvedDescriptor.descriptor)
  if (!match) return null

  const context: FormatContext = {
    descriptor: resolvedDescriptor.descriptor,
    root: {
      ...match.values,
      '@': {
        to: call.to,
        value: call.value,
        data: call.data,
        chainId
      }
    },
    chainId
  }
  const fullVisualization = formatToVisualizations(match.format, context, call.dapp)

  return fullVisualization?.length ? { ...call, fullVisualization, warnings: [] } : null
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

  return fullVisualization?.length
    ? { ...message, fullVisualization, warnings: [], canHideDropdownArrow: true }
    : null
}
