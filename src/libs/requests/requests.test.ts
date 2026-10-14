import { describe, expect, test } from '@jest/globals'

import { Account } from '../../interfaces/account'
import { UserRequest } from '../../interfaces/userRequest'
import { isSignedSafeCallsRequest } from './requests'

const SAFE_ADDR = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const SAFE_OWNER = '0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'
const SAFE_CREATION: Account['safeCreation'] = {
  factoryAddr: SAFE_ADDR,
  singleton: SAFE_ADDR,
  saltNonce: '0x00',
  setupData: '0x',
  version: '1.4.1'
}

const makeCallsRequest = ({
  safeCreation,
  signed
}: {
  safeCreation?: Account['safeCreation']
  signed?: string[]
}): UserRequest =>
  ({
    id: 'calls-request',
    kind: 'calls',
    meta: {},
    dappPromises: [],
    signAccountOp: { account: { safeCreation }, accountOp: { signed } }
  }) as unknown as UserRequest

describe('isSignedSafeCallsRequest', () => {
  test('matches a Safe transaction that an owner has signed', () => {
    const request = makeCallsRequest({ safeCreation: SAFE_CREATION, signed: [SAFE_OWNER] })

    expect(isSignedSafeCallsRequest(request)).toBe(true)
  })

  test('does not match a Safe transaction that no owner has signed yet', () => {
    const neverSigned = makeCallsRequest({ safeCreation: SAFE_CREATION })
    const emptySigners = makeCallsRequest({ safeCreation: SAFE_CREATION, signed: [] })

    expect(isSignedSafeCallsRequest(neverSigned)).toBe(false)
    expect(isSignedSafeCallsRequest(emptySigners)).toBe(false)
  })

  test('does not match a signed transaction of an account that is not a Safe', () => {
    const request = makeCallsRequest({ signed: [SAFE_OWNER] })

    expect(isSignedSafeCallsRequest(request)).toBe(false)
  })

  test('does not match a request that is not a transaction', () => {
    const request = {
      id: 'message-request',
      kind: 'message',
      meta: { accountAddr: SAFE_ADDR, signed: [SAFE_OWNER] },
      dappPromises: []
    } as unknown as UserRequest

    expect(isSignedSafeCallsRequest(request)).toBe(false)
  })
})
