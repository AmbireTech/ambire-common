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

/** The base type name of a field type, without any array suffix (`Person[]` -> `Person`) */
function getBaseTypeName(typeName: string): string {
  const arrayStart = typeName.indexOf('[')

  return arrayStart === -1 ? typeName : typeName.slice(0, arrayStart)
}

function getReachableTypeNames(
  types: TypedDataTypes,
  rootTypeNames: string[],
  reachable: Set<string> = new Set()
): Set<string> {
  rootTypeNames.forEach((typeName) => {
    if (reachable.has(typeName) || !types[typeName]) return

    reachable.add(typeName)
    getReachableTypeNames(
      types,
      types[typeName].map((field) => getBaseTypeName(field.type)),
      reachable
    )
  })

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

  const reachableTypeNames = getReachableTypeNames(types, [primaryType, 'EIP712Domain'])

  return {
    ...typedData,
    types: Object.fromEntries(
      Object.entries(types).filter(([typeName]) => reachableTypeNames.has(typeName))
    ),
    domain: getSignedDomain(types, domain),
    message: getSignedMessage(types, primaryType, message)
  }
}
