import { TypedDataUtils } from '@metamask/eth-sig-util'

/** The struct definitions of an EIP-712 typed message, as passed in `types` */
type TypedDataTypes = Record<string, Array<{ name: string; type: string }>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The signers decide what a field type is in this order: a name that is declared in `types` is a
 * struct (even if the name looks like an array, for example `T[]`), otherwise a name that ends
 * with `]` is an array, otherwise it is an atomic type
 */
function getStructFields(types: TypedDataTypes, typeName: string) {
  const fields = Object.prototype.hasOwnProperty.call(types, typeName) ? types[typeName] : undefined

  return Array.isArray(fields) ? fields : undefined
}

function getSignedValue(types: TypedDataTypes, typeName: string, value: unknown): unknown {
  const fields = getStructFields(types, typeName)

  if (!fields && typeName.endsWith(']')) {
    if (!Array.isArray(value)) return value
    const elementTypeName = typeName.slice(0, typeName.lastIndexOf('['))
    return value.map((element) => getSignedValue(types, elementTypeName, element))
  }

  // Atomic types (address, uint256, etc.) have no fields to narrow down
  if (!fields) return value
  // A missing struct is hashed as zero, so there is nothing to narrow
  if (value === null || value === undefined) return value

  // The signature reads every declared field from the value as it is, also when it is a string or
  // an array (for example their `length`). So the fields are read the same way here, and the rest
  // of the value, which is not signed, is dropped
  const source = Object(value)

  // One object, filled in one pass. Copying the object for every field would make the cost grow
  // with the square of the number of fields, and an app decides how many fields a struct has
  const signedValue: Record<string, unknown> = {}
  fields.forEach((field) => {
    if (!(field.name in source)) return

    signedValue[field.name] = getSignedValue(types, field.type, source[field.name])
  })

  return signedValue
}

/**
 * Whether a struct in `types` declares two fields with the same name. A Solidity struct cannot do
 * this, but the signing libraries accept it: they read the same message key once for every
 * declaration. A narrowed message holds one value per key, so it cannot keep what both
 * declarations need, and the digest would change. Such typed data should not be accepted.
 */
export function hasDuplicateFieldNames(types: TypedDataTypes): boolean {
  return Object.values(types).some((fields) => {
    if (!Array.isArray(fields)) return false

    return new Set(fields.map((field) => field?.name)).size < fields.length
  })
}

/**
 * Returns only the part of a typed message that the signature actually covers.
 * The EIP-712 hash includes just the fields declared in `types[primaryType]` (and the structs
 * they reference), including the ones nested in other structs and arrays. Any other key in
 * `message` is ignored when signing, so it must be ignored when showing the message too.
 * Otherwise the screen could show values that are not signed.
 */
export function getSignedMessage(
  types: TypedDataTypes,
  primaryType: string,
  message: Record<string, any>
): Record<string, any> {
  const signedMessage = getSignedValue(types, primaryType, message)

  return isRecord(signedMessage) ? signedMessage : {}
}

/**
 * Returns only the domain fields that the signature covers: the ones declared in
 * `types.EIP712Domain`. When `EIP712Domain` is not declared, the domain is returned as is.
 */
export function getSignedDomain(
  types: TypedDataTypes,
  domain: Record<string, any>
): Record<string, any> {
  return getSignedMessage(types, 'EIP712Domain', domain)
}

/** The types that are needed to encode a value of the given type, found with the signer's order */
function getEncodedTypeNames(
  types: TypedDataTypes,
  typeName: string,
  reachable: Set<string> = new Set()
): Set<string> {
  const fields = getStructFields(types, typeName)

  if (fields) {
    if (reachable.has(typeName)) return reachable

    reachable.add(typeName)
    fields.forEach((field) => getEncodedTypeNames(types, field.type, reachable))
  } else if (typeName.endsWith(']')) {
    getEncodedTypeNames(types, typeName.slice(0, typeName.lastIndexOf('[')), reachable)
  }

  return reachable
}

/**
 * Narrows a typed message to what the signature actually covers:
 * - the domain keeps only the fields declared in `types.EIP712Domain`
 * - the message keeps only the fields declared in the types, at every level
 * - `types` keeps only the types that the primary type and `EIP712Domain` can reach
 *
 * Returns a new object and never changes the one it receives. Only the levels that are narrowed
 * are copied, the values inside them are shared. When there is no primary type, or it is not
 * declared in `types`, there is nothing to narrow it by and the typed message is returned as it is.
 */
export function pruneDomainContentAndTypes<
  T extends {
    types: TypedDataTypes
    domain: Record<string, any>
    message: Record<string, any>
    primaryType?: string
  }
>(typedData: T): T {
  const { types, domain, message, primaryType } = typedData
  if (!primaryType || !types[primaryType]) return typedData

  // The types that the signer lists in the type string, found with its own rule, plus the types
  // that it needs to encode the values. Both can differ for unusual type names (for example a
  // struct named `T[]`), and dropping either changes the digest
  const reachableTypeNames = new Set([
    ...TypedDataUtils.findTypeDependencies(primaryType, types),
    ...TypedDataUtils.findTypeDependencies('EIP712Domain', types),
    ...getEncodedTypeNames(types, primaryType),
    ...getEncodedTypeNames(types, 'EIP712Domain')
  ])

  return {
    ...typedData,
    types: Object.fromEntries(
      Object.entries(types).filter(([typeName]) => reachableTypeNames.has(typeName))
    ),
    domain: getSignedDomain(types, domain),
    message: getSignedMessage(types, primaryType, message)
  }
}
