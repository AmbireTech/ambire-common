import { TypedDataUtils } from '@metamask/eth-sig-util'

/** The struct definitions of an EIP-712 typed message, as passed in `types` */
type TypedDataTypes = Record<string, Array<{ name: string; type: string }>>

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
const isAtomic = (t: string) =>
  t === 'address' ||
  t === 'bool' ||
  t === 'string' ||
  t === 'bytes' ||
  /^bytes([1-9]|[12][0-9]|3[0-2])$/.test(t) ||
  /^u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)$/.test(
    t
  )

/**
 * The fields of a struct type, or `undefined` when the name is not a struct. Only an own property
 * that holds an array counts, so a name such as `toString` is never read from the prototype
 */
function getStructFields(types: TypedDataTypes, typeName: string) {
  if (!Object.prototype.hasOwnProperty.call(types, typeName)) return undefined

  const fields = types[typeName]
  return Array.isArray(fields) ? fields : undefined
}

/**
 * Returns only the part of a typed message that the signature actually covers.
 * The EIP-712 hash includes just the fields declared in `types[primaryType]` (and the structs
 * they reference), including the ones nested in other structs and arrays. Any other key in
 * `message` is ignored when signing, so it must be ignored when showing the message too.
 * Otherwise the screen could show values that are not signed.
 */
export function reduceMessageTo(
  allMessageTypes: TypedDataTypes,
  reducingToType: string,
  message: unknown
): any {
  // The signers check for a struct first, so a struct that is named like an atomic type (for
  // example `string`) or like an array (for example `T[]`) is read as a struct here too
  const foundType = getStructFields(allMessageTypes, reducingToType)
  if (foundType) {
    // A missing struct has no fields to narrow
    if (message === null || message === undefined) return message

    // The signers read every declared field from the value as it is, also when it is a string or
    // an array (for example their `length`). So only the declared fields are read here, the same
    // way, and no other key of the value is parsed
    const source = Object(message)
    // Object.fromEntries always creates own keys. An assignment such as `obj['__proto__'] = value`
    // would set the prototype instead, so a signed field with that name would be hidden from the
    // keys that the screen shows and from the JSON that is sent to the UI
    return Object.fromEntries(
      foundType
        .filter(({ name }) => name in source)
        .map(({ name, type }) => [name, reduceMessageTo(allMessageTypes, type, source[name])])
    )
  }

  if (reducingToType.endsWith(']')) {
    // No signer can encode a value that is not an array for an array type, so it is never signed.
    // Without this check a string would throw on `.map`
    if (!Array.isArray(message)) return

    const lastIndexOfOpen = reducingToType.lastIndexOf('[')
    const innerType = reducingToType.slice(0, lastIndexOfOpen)
    const declaredLength = reducingToType.slice(lastIndexOfOpen + 1, -1)

    // A fixed array (`T[2]`) keeps only the declared number of items, so the extra ones are never
    // parsed. It is never filled in when it has fewer items. Note: viem encodes every item it gets
    // and does not check the length, so a request with extra items gets a different digest after
    // this cut and is rejected by the digest check in the requests controller.
    // A dynamic array (`T[]`, empty between the brackets) keeps all its items
    const limitedItems = declaredLength === '' ? message : message.slice(0, Number(declaredLength))

    return limitedItems.map((item) => reduceMessageTo(allMessageTypes, innerType, item))
  }

  if (isAtomic(reducingToType)) return message

  // Not a struct, an array or an atomic type, so the signers cannot encode it
  return undefined
}

/**
 * Returns only the domain fields that the signature covers: the ones declared in
 * `types.EIP712Domain`. When `EIP712Domain` is not declared, the domain is returned as is.
 */
export function getSignedDomain(
  types: TypedDataTypes,
  domain: Record<string, any>
): Record<string, any> {
  // Without a declared EIP712Domain there is nothing to narrow the domain by. The signers do not
  // agree on what they sign in this case (viem builds the domain type from up to five known keys,
  // the software signer signs an empty domain), so the requests controller rejects such typed data
  // and the signing refuses it too
  if (!types.EIP712Domain) return domain

  return reduceMessageTo(types, 'EIP712Domain', domain)
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
    message: reduceMessageTo(types, primaryType, message)
  }
}
