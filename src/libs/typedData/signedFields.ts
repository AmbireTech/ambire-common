/** The struct definitions of an EIP-712 typed message, as passed in `types` */
type TypedDataTypes = Record<string, Array<{ name: string; type: string }>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getSignedValue(types: TypedDataTypes, typeName: string, value: unknown): unknown {
  if (typeName.endsWith(']')) {
    if (!Array.isArray(value)) return value
    const elementTypeName = typeName.slice(0, typeName.lastIndexOf('['))
    return value.map((element) => getSignedValue(types, elementTypeName, element))
  }

  const fields = types[typeName]
  // Atomic types (address, uint256, etc.) have no fields to narrow down
  if (!fields || !isRecord(value)) return value

  return fields.reduce<Record<string, unknown>>((signedValue, field) => {
    if (!(field.name in value)) return signedValue

    return { ...signedValue, [field.name]: getSignedValue(types, field.type, value[field.name]) }
  }, {})
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
