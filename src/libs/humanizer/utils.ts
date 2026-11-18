import type { TypedDataDomain } from 'ethers'
import { getAddress, Hex, isAddress, isHex, zeroAddress } from 'viem'

import {
  HumanizerErc7730Row,
  HumanizerMeta,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall
} from './interfaces'

export type HexIrCall = IrCall & { data: Hex }

/** Type guard that narrows an IrCall to one with a valid hex data field. */
export function isHexCall(call: IrCall): call is HexIrCall {
  return isHex(call.data)
}

/** An EIP-712 field: its name and its type */
export type TypedDataField = { name: string; type: string }

/** EIP-712 type definitions of a typed message, keyed by type name */
type TypedDataTypes = Record<string, TypedDataField[]> | undefined

/**
 * A field type in an expected definition that the app chooses (e.g. the Permit2
 * witness). Any struct type declared in the message `types` is accepted for it. The
 * message must still have exactly the fields that this struct declares.
 */
export const APP_DEFINED_STRUCT_TYPE = '<app-defined struct>'

/**
 * The signed EIP-712 definition that a humanizer expects: the primary type and
 * every struct type that it uses, with the fields in the signed order.
 */
export type ExpectedTypedData = {
  primaryType: string
  types: Record<string, TypedDataField[]>
}

/** The type of the items of an array type (`T[]` or `T[N]` gives `T`) and the fixed length, if any */
const splitArrayType = (type: string): { itemType: string; fixedLength?: number } | null => {
  if (!type.endsWith(']')) return null

  const openBracketIndex = type.lastIndexOf('[')
  const lengthText = type.slice(openBracketIndex + 1, -1)
  return {
    itemType: type.slice(0, openBracketIndex),
    fixedLength: lengthText === '' ? undefined : Number(lengthText)
  }
}

/** The struct or atomic type without array dimensions (`T[2][]` gives `T`) */
const getBaseType = (type: string): string => {
  const openBracketIndex = type.indexOf('[')
  return openBracketIndex === -1 ? type : type.slice(0, openBracketIndex)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStructType = (types: Record<string, TypedDataField[]>, type: string): boolean =>
  Object.hasOwn(types, getBaseType(type))

/**
 * Tells if the signed types of a typed message are exactly the expected ones.
 * Starting from the primary type, every struct type that is used (also nested
 * and in arrays) must have the same field names and types, in the same order.
 */
const hasExactTypes = (
  types: Record<string, TypedDataField[]>,
  expected: ExpectedTypedData
): boolean => {
  const checkedStructNames = new Set<string>()

  const isExactStruct = (structName: string): boolean => {
    if (checkedStructNames.has(structName)) return true
    checkedStructNames.add(structName)

    const fields = types[structName]
    const expectedFields = expected.types[structName]
    if (!fields || !expectedFields || fields.length !== expectedFields.length) return false

    return expectedFields.every((expectedField, index) => {
      const field = fields[index]!
      if (field.name !== expectedField.name) return false
      // The app defines this struct, so only check that it is a declared struct
      if (expectedField.type === APP_DEFINED_STRUCT_TYPE)
        return !splitArrayType(field.type) && isStructType(types, field.type)
      if (field.type !== expectedField.type) return false

      return !isStructType(types, field.type) || isExactStruct(getBaseType(field.type))
    })
  }

  return isExactStruct(expected.primaryType)
}

/**
 * Tells if the message has every declared field, also in nested structs and in
 * each array item. Arrays of a fixed length must have that length. Extra keys are
 * allowed: they are not signed, and humanizers read only declared fields. Atomic
 * values are not checked here.
 */
const hasAllDeclaredMessageFields = (
  types: Record<string, TypedDataField[]>,
  type: string,
  value: unknown
): boolean => {
  const arrayType = splitArrayType(type)
  if (arrayType) {
    if (!Array.isArray(value)) return false
    if (arrayType.fixedLength !== undefined && value.length !== arrayType.fixedLength) return false
    return value.every((item) => hasAllDeclaredMessageFields(types, arrayType.itemType, item))
  }
  if (!isStructType(types, type)) return true

  if (!isPlainObject(value)) return false

  return types[type]!.every(
    (field) =>
      Object.hasOwn(value, field.name) &&
      hasAllDeclaredMessageFields(types, field.type, value[field.name])
  )
}

/**
 * Tells if a typed message is exactly the expected EIP-712 definition: the same
 * primary type, the same signed types (recursively) and a message that has every
 * declared field (recursively). A type that differs is a different signed
 * message, so a humanizer must not show it as this one. Extra keys in the message
 * are allowed: they are not signed, so a humanizer must read only declared fields.
 */
export function isExactTypedData(
  typedData: { primaryType: string; types: Record<string, TypedDataField[]>; message: unknown },
  expected: ExpectedTypedData
): boolean {
  const { primaryType, types, message } = typedData
  if (primaryType !== expected.primaryType || !hasExactTypes(types, expected)) return false

  return hasAllDeclaredMessageFields(types, primaryType, message)
}

/** The standard EIP-712 domain fields, with the type each one must be declared with */
const EIP712_DOMAIN_FIELD_TYPES: Record<keyof TypedDataDomain, string> = {
  name: 'string',
  version: 'string',
  chainId: 'uint256',
  verifyingContract: 'address',
  salt: 'bytes32'
}

const isStandardDomainField = (
  field: TypedDataField
): field is TypedDataField & {
  name: keyof TypedDataDomain
} =>
  Object.entries(EIP712_DOMAIN_FIELD_TYPES).some(
    ([name, type]) => name === field.name && type === field.type
  )

/**
 * Returns only the domain fields that `types.EIP712Domain` declares with their standard
 * type. The signature includes only these, so humanizers must not read other domain
 * fields. Without `EIP712Domain`, no field is declared (the wallet does not sign such
 * a typed message).
 */
export function getDeclaredDomain(typedData: {
  types: Record<string, TypedDataField[]>
  domain: TypedDataDomain
}): TypedDataDomain {
  const { types, domain } = typedData
  const declaredFields = Object.hasOwn(types, 'EIP712Domain') ? types.EIP712Domain : undefined
  if (!Array.isArray(declaredFields) || !isPlainObject(domain)) return {}

  const declaredDomain: TypedDataDomain = {}
  declaredFields.filter(isStandardDomainField).forEach(({ name }) => {
    if (Object.hasOwn(domain, name)) Object.assign(declaredDomain, { [name]: domain[name] })
  })
  return declaredDomain
}

/** Returns the declared EIP-712 type of a field, or undefined when the field is not declared (not signed) */
export function getDeclaredFieldType(
  types: TypedDataTypes,
  typeName: string,
  fieldName: string
): string | undefined {
  return types?.[typeName]?.find((field) => field.name === fieldName)?.type
}
/**
 * Lower-cases a hex string. Hex is case-insensitive onchain, but function selectors are compared
 * as plain strings across the humanizer (and viem's `decodeFunctionData` matches its ABI the same
 * way), so upper or mixed-case calldata would otherwise skip every selector check, including the
 * ones that raise security warnings.
 */
export const toLowerCaseHex = (value: Hex): Hex => value.toLowerCase() as Hex

/** Returns the call with its calldata lower-cased (see `toLowerCaseHex`), or as is if it isn't hex */
export const withLowerCaseCallData = (call: IrCall): IrCall =>
  isHexCall(call) ? { ...call, data: toLowerCaseHex(call.data) } : call

export function getWarning(
  content: string,
  code: HumanizerWarning['code'],
  blocking?: boolean,
  address?: string
): HumanizerWarning {
  return { content, blocking, code, address }
}

/**
 * Removes repeated warnings, keeping the first of each kind. Warnings for the same call can come
 * from more than one source (a humanizer module and an ERC-7730 descriptor), so the same concern
 * can be reported twice. Two warnings are the same only when their code, text and address all
 * match - warnings that share a code but say different things are all kept.
 */
export const dedupeWarnings = (warnings: HumanizerWarning[]): HumanizerWarning[] => {
  const warningKeys = new Set<string>()

  return warnings.filter((warning) => {
    const warningKey = `${warning.code}:${warning.content}:${warning.address || ''}`
    if (warningKeys.has(warningKey)) return false
    warningKeys.add(warningKey)

    return true
  })
}

/**
 * Adds warnings to the ones a call already carries, without repeating any. Modules run one after
 * another over the same call, so a module must never replace what an earlier one found. Returns
 * undefined when there is nothing to report, so calls without warnings keep their original shape.
 */
export const mergeWarnings = (
  existingWarnings: HumanizerWarning[] | undefined,
  addedWarnings: HumanizerWarning[]
): HumanizerWarning[] | undefined => {
  if (!existingWarnings?.length && !addedWarnings.length) return undefined

  return dedupeWarnings([...(existingWarnings || []), ...addedWarnings])
}

/**
 * Marks an approval that has no spending limit. `SignAccountOpController` removes warnings with
 * this code when the app that made the request is in the default Ambire catalog, so every module
 * that reports an unlimited approval must use this exact code.
 */
export const UNLIMITED_APPROVAL_WARNING_CODE = 'UNLIMITED_APPROVAL'

const MAX_AMOUNT_BY_BITS: { [bits: number]: bigint } = {
  256: 2n ** 256n - 1n,
  160: 2n ** 160n - 1n
}

/**
 * True when the amount is the largest value its type can hold. Contracts use this value to mean
 * "no limit". Only the exact maximum counts, so a large but finite approval is not reported.
 */
export const isUnlimitedAmount = (amount: bigint, bits: 256 | 160 = 256): boolean =>
  amount === MAX_AMOUNT_BY_BITS[bits]

/**
 * Warns that an approval lets the spender take any amount of the token, with no limit. The address
 * is lowercased to match `getAddressVisualization`, so both spellings of it compare as equal.
 */
export const getUnlimitedApprovalWarning = (spender: string): HumanizerWarning =>
  getWarning(
    'This app can spend this token from your account with no limit. Continue only if you trust it.',
    UNLIMITED_APPROVAL_WARNING_CODE,
    false,
    spender.toLowerCase()
  )

export const randomId = (): number => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

export function getLabel(
  content: string | bigint | number,
  isBold?: boolean
): HumanizerVisualization {
  return { type: 'label', content: content.toString(), id: randomId(), isBold }
}
export function getAction(
  content: string,
  options?: { warning?: boolean }
): HumanizerVisualization {
  return { type: 'action', content, id: randomId(), warning: options?.warning }
}
export function getImage(content: string): HumanizerVisualization {
  return { type: 'image', content, id: randomId() }
}
export function getBreak(): HumanizerVisualization {
  return { type: 'break', id: randomId() }
}

export function getAddressVisualization(_address: string): HumanizerVisualization {
  const address = _address.toLowerCase()
  return { type: 'address', address, id: randomId() }
}

export function getToken(
  _address: string,
  amount: bigint,
  chainId?: bigint
): HumanizerVisualization {
  const address = _address.toLowerCase()
  return {
    type: 'token',
    address,
    value: BigInt(amount),
    id: randomId(),
    chainId
  }
}
export function getTokenWithChain(
  address: string,
  amount: bigint,
  chainId?: bigint
): HumanizerVisualization {
  return getToken(address, amount, chainId)
}

export function getChain(chainId: bigint): HumanizerVisualization {
  return { type: 'chain', id: randomId(), chainId }
}

export function getText(text: string, mlMi?: boolean): HumanizerVisualization {
  return { type: 'text', content: text, id: randomId(), mlMi }
}

/** The visualizations a row renders - a `call` row keeps its parts flat, every other row has one. */
export function getErc7730RowValues(row: HumanizerErc7730Row): HumanizerVisualization[] {
  return row.type === 'call' ? row.value : [row.value]
}

/** A `call` row renders an embedded call inline and has no label of its own. */
export function getErc7730RowLabel(row: HumanizerErc7730Row): string {
  return row.type === 'call' ? '' : row.label
}

export function getErc7730Visualization(
  intent: string | undefined,
  rows: HumanizerErc7730Row[],
  dapp?: IrCall['dapp'],
  // Present only when the format used an `interpolatedIntent` that fully
  // resolved: `parts` is the structured breakdown to render, `usedFieldPaths`
  // is which fields (by `HumanizerErc7730Row.path`) it already rendered inline
  // - see `excludedFieldPaths` on `HumanizerErc7730Visualization`.
  interpolated?: { parts: HumanizerVisualization[]; usedFieldPaths: string[] }
): HumanizerVisualization {
  return {
    type: 'erc7730',
    // When interpolation succeeded, show the rich breakdown and exclude
    // whatever fields it already rendered inline (that can legitimately be
    // every field, e.g. when the whole template referenced them all).
    // Otherwise there was nothing rendered inline to exclude anything for, so
    // this falls back to the plain action with nothing excluded.
    intent: interpolated?.parts ?? (intent ? [getAction(intent)] : []),
    excludedFieldPaths: interpolated?.usedFieldPaths ?? [],
    fields: rows,
    dapp,
    id: randomId()
  }
}

export function flattenHumanizerVisualizations(
  visualizations: HumanizerVisualization[] = []
): HumanizerVisualization[] {
  return visualizations.flatMap((visualization) => {
    if (visualization.type !== 'erc7730') return [visualization]

    return [
      visualization,
      // `fields` (every field, not just the ones displayed as rows) so nested
      // values that only show up inline in `intent` (e.g. a token amount) are
      // still discovered here.
      ...flattenHumanizerVisualizations(visualization.fields.flatMap(getErc7730RowValues))
    ]
  })
}

export function hasErc7730Humanization(humanization?: IrCall[]): boolean {
  return !!humanization?.some((call) =>
    flattenHumanizerVisualizations(call.fullVisualization).some(
      (visualization) => visualization.type === 'erc7730'
    )
  )
}

export function getOnBehalfOf(onBehalfOf: string, sender: string): HumanizerVisualization[] {
  return onBehalfOf.toLowerCase() !== sender.toLowerCase()
    ? [getLabel('on behalf of'), getAddressVisualization(onBehalfOf)]
    : []
}

// @TODO on some humanization of uniswap there is recipient 0x000...000
/**
 * The label that `getRecipientText` puts right before the recipient address.
 * Code that merges or removes visualizations (e.g. `uniReduce`) uses it to find the recipient
 * of an action, so it must stay in sync with `getRecipientText`.
 */
export const RECIPIENT_LABEL = 'and send it to'

export function getRecipientText(from: string, recipient: string): HumanizerVisualization[] {
  return from.toLowerCase() === recipient.toLowerCase()
    ? []
    : [getLabel(RECIPIENT_LABEL), getAddressVisualization(recipient)]
}

export function getDeadlineText(deadline: bigint): string {
  const minute = 60000n
  const diff = BigInt(deadline) - BigInt(Date.now())

  if (diff < 0 && diff > -minute * 2n) return 'expired just now'
  if (diff < 0) return 'already expired'
  if (diff < minute) return 'expires in less than a minute'
  if (diff < 30n * minute) return `expires in ${Math.floor(Number(diff / minute))} minutes`
  if ((deadline / 1000n).toString(16) === 'f'.repeat(64)) return 'No expiration date'
  if (deadline.toString(16) === 'f'.repeat(64)) return 'No expiration date'
  const deadlineDate = new Date(Number(deadline))
  if (isNaN(deadlineDate.getTime())) return 'Invalid expiration date'

  return `valid until ${deadlineDate.toLocaleString()}`
}

export function getDeadline(deadlineSecs: bigint | number): HumanizerVisualization {
  const deadline = BigInt(deadlineSecs) * 1000n
  return {
    type: 'deadline',
    value: deadline,
    id: randomId()
  }
}
export function getLink(url: string, content: string): HumanizerVisualization {
  return { type: 'link', url, content, id: randomId() }
}

export function getWrapping(address: string, amount: bigint): HumanizerVisualization[] {
  return [getAction('Wrap'), getToken(address, amount)]
}

export function getUnwrapping(address: string, amount: bigint): HumanizerVisualization[] {
  return [getAction('Unwrap'), getToken(address, amount)]
}

// @TODO cant this be used in the <Address component>
export function getKnownName(
  humanizerMeta: HumanizerMeta | undefined,
  address: string
): string | undefined {
  if (!isAddress(address)) return
  return humanizerMeta?.knownAddresses?.[getAddress(address)]?.name
}

// Looks up a 4-byte function selector across every known ABI (not just the ABI of the call's
// target contract), since humanizerMeta has no reverse index from contract address to ABI name.
export function getKnownFunctionName(
  humanizerMeta: HumanizerMeta | undefined,
  selector: string
): string | undefined {
  const normalizedSelector = selector.toLowerCase()
  const matchingFragment = Object.values(humanizerMeta?.abis || {})
    .map((abi) => abi[normalizedSelector])
    .find((fragment) => fragment?.type === 'function')

  const signaturePrefix = 'function '
  const functionSignature = matchingFragment?.signature.startsWith(signaturePrefix)
    ? matchingFragment.signature.slice(signaturePrefix.length)
    : undefined
  const functionNameEnd = functionSignature?.indexOf('(') ?? -1

  return functionNameEnd >= 0 ? functionSignature?.slice(0, functionNameEnd).trim() : undefined
}

export const EMPTY_HUMANIZER_META = { abis: { NO_ABI: {} }, knownAddresses: {} }

export const uintToAddress = (uint: bigint): string =>
  `0x${BigInt(uint).toString(16).slice(-40).padStart(40, '0')}`

export const eToNative = (address: string): string =>
  address.slice(2).toLocaleLowerCase() === 'e'.repeat(40) ? zeroAddress : address

// tokens before solidity 0.5.0 would accept calldata that is shorter then the specified
// args in the abi and assume they are 0s
// other tokens fail onchain, so there is no real danger in padding to the end
// as long as it is kept in the humanizer
// applicable only to functions whose args are all static (one 32 byte word each)
export const padCallData = (data: Hex, staticArgsCount: number): Hex => {
  const expectedCallLength = 2 + 8 + staticArgsCount * 64
  return data.padEnd(expectedCallLength, '0') as Hex
}
