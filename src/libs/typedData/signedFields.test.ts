import { describe, expect, test } from '@jest/globals'

import { getSignedDomain, getSignedMessage } from './signedFields'

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
