import { keccak256, toUtf8Bytes } from 'ethers'

import { Erc7730TypedDataTypes } from './types'

const getBaseType = (type: string) => {
  let baseType = ''
  let index = 0

  while (index < type.length) {
    const char = type[index]
    if (char !== '[') {
      baseType += char
      index += 1
      continue
    }

    const closingBracketIndex = type.indexOf(']', index + 1)
    if (closingBracketIndex === -1) {
      baseType += type.slice(index)
      break
    }

    index = closingBracketIndex + 1
  }

  return baseType
}

const encodeTypeFragment = (typeName: string, types: Erc7730TypedDataTypes): string => {
  const fields = types[typeName]
  if (!fields) throw new Error(`Missing EIP-712 type ${typeName}`)

  return `${typeName}(${fields.map(({ name, type }) => `${type} ${name}`).join(',')})`
}

export const getEip712EncodeType = (types: Erc7730TypedDataTypes, primaryType: string): string => {
  if (!types[primaryType]) throw new Error(`Missing primary EIP-712 type ${primaryType}`)

  const customTypeNames = new Set(
    Object.keys(types).filter((typeName) => typeName !== 'EIP712Domain')
  )
  const dependencies = new Set<string>()

  const collectDependencies = (typeName: string) => {
    const fields = types[typeName]
    if (!fields) return

    fields.forEach(({ type }) => {
      const baseType = getBaseType(type)
      if (!customTypeNames.has(baseType) || dependencies.has(baseType)) return

      dependencies.add(baseType)
      collectDependencies(baseType)
    })
  }

  collectDependencies(primaryType)
  dependencies.delete(primaryType)

  return [primaryType, ...Array.from(dependencies).sort()]
    .map((typeName) => encodeTypeFragment(typeName, types))
    .join('')
}

export const getEip712EncodeTypeHash = (
  types: Erc7730TypedDataTypes,
  primaryType: string
): string => keccak256(toUtf8Bytes(getEip712EncodeType(types, primaryType))).toLowerCase()

export const getEip712EncodeTypeHashFromString = (encodeType: string): string =>
  keccak256(toUtf8Bytes(encodeType)).toLowerCase()
