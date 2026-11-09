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
