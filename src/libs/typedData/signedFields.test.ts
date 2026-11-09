import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util'

import { describe, expect, test } from '@jest/globals'

import { getSignedDomain, getSignedMessage, pruneDomainContentAndTypes } from './signedFields'

const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const types = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' }
  ],
  Person: [{ name: 'wallet', type: 'address' }],
  Mail: [
    { name: 'from', type: 'Person' },
    { name: 'to', type: 'Person[]' },
    { name: 'ids', type: 'uint256[3]' },
    { name: 'contents', type: 'string' }
  ]
}

describe('getSignedMessage', () => {
  test('keeps a message that has only declared fields as it is', () => {
    const message = {
      from: { wallet: ADDRESS },
      to: [{ wallet: ADDRESS }],
      ids: [1n, 2n, 3n],
      contents: 'Hello!'
    }

    expect(getSignedMessage(types, 'Mail', message)).toEqual(message)
  })

  test('drops undeclared fields at the top level, in structs and in arrays of structs', () => {
    const signedMessage = getSignedMessage(types, 'Mail', {
      from: { wallet: ADDRESS, extraNested: 1 },
      to: [{ wallet: ADDRESS, extraInArray: 2 }],
      ids: [1n, 2n, 3n],
      contents: 'Hello!',
      extraTopLevel: 3
    })

    expect(signedMessage).toEqual({
      from: { wallet: ADDRESS },
      to: [{ wallet: ADDRESS }],
      ids: [1n, 2n, 3n],
      contents: 'Hello!'
    })
  })

  test('does not add declared fields that the message does not have', () => {
    expect(getSignedMessage(types, 'Mail', { contents: 'Hello!' })).toEqual({
      contents: 'Hello!'
    })
  })

  test('reads the declared fields from a string or an array where a struct is expected', () => {
    // The signature reads `length` from the value, so the pruned value must hold exactly that
    const lengthTypes = {
      EIP712Domain: [{ name: 'name', type: 'string' }],
      P: [{ name: 'length', type: 'uint256' }],
      M: [{ name: 'p', type: 'P' }]
    }
    const withString = {
      types: lengthTypes,
      domain: { name: 'App' },
      primaryType: 'M',
      message: { p: 'Send 1000 ETH' }
    }
    const withArray = { ...withString, message: { p: [1, 2, 3] } }

    expect(pruneDomainContentAndTypes(withString).message).toEqual({ p: { length: 13 } })
    expect(pruneDomainContentAndTypes(withArray).message).toEqual({ p: { length: 3 } })
    ;[withString, withArray].forEach((typedData) => {
      expect(
        TypedDataUtils.eip712Hash(
          pruneDomainContentAndTypes(typedData) as any,
          SignTypedDataVersion.V4
        ).toString('hex')
      ).toBe(TypedDataUtils.eip712Hash(typedData as any, SignTypedDataVersion.V4).toString('hex'))
    })
  })

  test('keeps a missing struct value as it is', () => {
    expect(getSignedMessage(types, 'Mail', { from: null })).toEqual({ from: null })
    expect(getSignedMessage(types, 'Mail', { from: undefined })).toEqual({ from: undefined })
  })

  test('narrows a struct with a very large number of fields quickly', () => {
    const fieldCount = 10000
    const fields = Array.from({ length: fieldCount }, (_, i) => ({
      name: `field${i}`,
      type: 'uint256'
    }))
    const message = Object.fromEntries(fields.map((field) => [field.name, 1]))
    const started = Date.now()

    const signedMessage = getSignedMessage({ Wide: fields }, 'Wide', {
      ...message,
      extraKey: 'extra'
    })

    expect(signedMessage).toEqual(message)
    // Copying the object for every field takes more than 10 seconds for this input
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test('does not change the message it receives', () => {
    const message = { contents: 'Hello!', extraTopLevel: 3 }
    getSignedMessage(types, 'Mail', message)

    expect(message).toEqual({ contents: 'Hello!', extraTopLevel: 3 })
  })

  test('returns an empty object when the primary type declares no fields', () => {
    expect(getSignedMessage({ Empty: [] }, 'Empty', { a: 1 })).toEqual({})
  })

  test('returns the message as it is when the primary type is not declared', () => {
    expect(getSignedMessage(types, 'Unknown', { a: 1 })).toEqual({ a: 1 })
  })

  test('keeps values that do not match the declared shape instead of throwing', () => {
    expect(getSignedMessage(types, 'Mail', { from: null, to: 'not-an-array' })).toEqual({
      from: null,
      to: 'not-an-array'
    })
  })
})

describe('getSignedDomain', () => {
  test('drops the domain fields that are not declared in EIP712Domain', () => {
    expect(
      getSignedDomain(types, { name: 'App', version: '1', chainId: 1n, verifyingContract: ADDRESS })
    ).toEqual({ name: 'App', version: '1' })
  })

  test('returns the domain as it is when EIP712Domain is not declared', () => {
    const domain = { name: 'App', chainId: 1n }

    expect(getSignedDomain({ Mail: types.Mail }, domain)).toEqual(domain)
  })
})

describe('pruneDomainContentAndTypes', () => {
  const typedData = {
    types: {
      ...types,
      Unused: [{ name: 'a', type: 'uint256' }],
      UnusedParent: [{ name: 'unused', type: 'Unused[]' }]
    },
    domain: { name: 'App', version: '1', chainId: 1n, verifyingContract: ADDRESS },
    primaryType: 'Mail',
    message: {
      from: { wallet: ADDRESS, extraNested: 1 },
      to: [{ wallet: ADDRESS, extraInArray: 2 }],
      ids: [1n, 2n, 3n],
      contents: 'Hello!',
      extraTopLevel: 3
    }
  }

  test('drops undeclared domain and message fields and the types that are not reachable', () => {
    const pruned = pruneDomainContentAndTypes(typedData)

    expect(pruned.domain).toEqual({ name: 'App', version: '1' })
    expect(pruned.message).toEqual({
      from: { wallet: ADDRESS },
      to: [{ wallet: ADDRESS }],
      ids: [1n, 2n, 3n],
      contents: 'Hello!'
    })
    expect(Object.keys(pruned.types)).toEqual(['EIP712Domain', 'Person', 'Mail'])
    expect(pruned.primaryType).toBe('Mail')
  })

  test('keeps the types that are reached only through arrays and nested structs', () => {
    const nestedTypes = {
      EIP712Domain: [{ name: 'name', type: 'string' }],
      Inner: [{ name: 'value', type: 'uint256' }],
      Middle: [{ name: 'inner', type: 'Inner[2][]' }],
      Outer: [{ name: 'middle', type: 'Middle' }],
      Unused: []
    }
    const pruned = pruneDomainContentAndTypes({
      types: nestedTypes,
      domain: { name: 'App' },
      primaryType: 'Outer',
      message: { middle: { inner: [[{ value: 1n, extra: 1 }, { value: 2n }]] } }
    })

    expect(Object.keys(pruned.types)).toEqual(['EIP712Domain', 'Inner', 'Middle', 'Outer'])
    expect(pruned.message).toEqual({ middle: { inner: [[{ value: 1n }, { value: 2n }]] } })
  })

  test('finds the reachable types with the same rule as the software signer', () => {
    // the signer reads the type name of `Foo-bar[]` up to the first non word character: `Foo`
    const typedDataWithOddTypeName = {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        Foo: [{ name: 'a', type: 'uint256' }],
        Unused: [{ name: 'b', type: 'uint256' }],
        M: [{ name: 'f', type: 'Foo-bar[]' }]
      },
      domain: { name: 'App' },
      primaryType: 'M',
      message: { f: [] }
    }
    const pruned = pruneDomainContentAndTypes(typedDataWithOddTypeName)

    expect(Object.keys(pruned.types)).toEqual(['EIP712Domain', 'Foo', 'M'])
    expect(TypedDataUtils.eip712Hash(pruned as any, SignTypedDataVersion.V4).toString('hex')).toBe(
      TypedDataUtils.eip712Hash(typedDataWithOddTypeName as any, SignTypedDataVersion.V4).toString(
        'hex'
      )
    )
  })

  test('treats a name that is declared in types as a struct, even if it looks like an array', () => {
    const typedDataWithBracketName = {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        'T[]': [{ name: 'x', type: 'uint256' }],
        M: [{ name: 'f', type: 'T[]' }]
      },
      domain: { name: 'App' },
      primaryType: 'M',
      message: { f: { x: 1, extra: 'unsigned' } }
    }
    const pruned = pruneDomainContentAndTypes(typedDataWithBracketName)

    expect(Object.keys(pruned.types)).toEqual(['EIP712Domain', 'T[]', 'M'])
    expect(pruned.message).toEqual({ f: { x: 1 } })
    expect(TypedDataUtils.eip712Hash(pruned as any, SignTypedDataVersion.V4).toString('hex')).toBe(
      TypedDataUtils.eip712Hash(typedDataWithBracketName as any, SignTypedDataVersion.V4).toString(
        'hex'
      )
    )
  })

  test('keeps the types that EIP712Domain reaches', () => {
    const pruned = pruneDomainContentAndTypes({
      types: {
        EIP712Domain: [{ name: 'custom', type: 'Custom' }],
        Custom: [{ name: 'a', type: 'uint256' }],
        Mail: [{ name: 'contents', type: 'string' }],
        Unused: []
      },
      domain: { custom: { a: 1n, extra: 2 } },
      primaryType: 'Mail',
      message: { contents: 'Hello!' }
    })

    expect(Object.keys(pruned.types)).toEqual(['EIP712Domain', 'Custom', 'Mail'])
    expect(pruned.domain).toEqual({ custom: { a: 1n } })
  })

  test('never changes the typed data it receives', () => {
    const deepFreeze = <T>(value: T): T => {
      if (typeof value !== 'object' || value === null) return value
      Object.values(value).forEach(deepFreeze)
      return Object.freeze(value)
    }
    const frozen = deepFreeze(structuredClone(typedData))
    const snapshot = structuredClone(typedData)

    expect(() => pruneDomainContentAndTypes(frozen)).not.toThrow()
    expect(frozen).toEqual(snapshot)
  })

  test('returns a new object when it prunes, with new levels for what it narrows', () => {
    const pruned = pruneDomainContentAndTypes(typedData)

    expect(pruned).not.toBe(typedData)
    expect(pruned.message).not.toBe(typedData.message)
    expect(pruned.message.from).not.toBe(typedData.message.from)
    expect(pruned.domain).not.toBe(typedData.domain)
  })

  test('returns the typed data as it is when there is no primary type', () => {
    const withoutPrimaryType = { ...typedData, primaryType: undefined }

    expect(pruneDomainContentAndTypes(withoutPrimaryType)).toBe(withoutPrimaryType)
  })

  test('returns the typed data as it is when the primary type is not declared', () => {
    const undeclared = { ...typedData, primaryType: 'Unknown' }

    expect(pruneDomainContentAndTypes(undeclared)).toBe(undeclared)
  })

  test('keeps a domain as it is when EIP712Domain is not declared', () => {
    const withoutDomainType = {
      types: { Mail: types.Mail, Person: types.Person },
      domain: { name: 'App', chainId: 1n },
      primaryType: 'Mail',
      message: { contents: 'Hello!' }
    }

    expect(pruneDomainContentAndTypes(withoutDomainType).domain).toEqual({
      name: 'App',
      chainId: 1n
    })
  })
})
