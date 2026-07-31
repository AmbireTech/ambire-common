import { describe, expect, test } from '@jest/globals'

import { Account } from '../interfaces/account'
import { CallsUserRequest } from '../interfaces/userRequest'
import { AccountOp } from '../libs/accountOp/accountOp'
import { getCallsCount } from './userRequest'

type RequestParams = {
  callsCount: number
  isSafe?: boolean
  signed?: string[]
}

const accountAddr = '0x0000000000000000000000000000000000000001'

const makeRequest = ({
  callsCount,
  isSafe = false,
  signed = []
}: RequestParams): CallsUserRequest => {
  const account: Account = {
    addr: accountAddr,
    associatedKeys: [],
    initialPrivileges: [],
    creation: null,
    safeCreation: isSafe
      ? {
          factoryAddr: accountAddr,
          singleton: accountAddr,
          saltNonce: '0x00',
          setupData: '0x',
          version: '1.4.1'
        }
      : undefined,
    preferences: { label: 'Test Account', pfp: accountAddr }
  }
  const accountOp: AccountOp = {
    id: 'account-op',
    accountAddr,
    chainId: 1n,
    signingKeyAddr: null,
    signingKeyType: null,
    nonce: 0n,
    calls: Array.from({ length: callsCount }, () => ({ value: 0n, data: '0x' })),
    gasLimit: null,
    signature: null,
    gasFeePayment: null,
    signed
  }

  return {
    id: 'request',
    kind: 'calls',
    meta: {
      accountAddr,
      chainId: 1n
    },
    dappPromises: [],
    signAccountOp: { account, accountOp } as CallsUserRequest['signAccountOp']
  }
}

describe('getCallsCount', () => {
  test('counts calls for an unsigned Safe request', () => {
    expect(getCallsCount([makeRequest({ callsCount: 2, isSafe: true })])).toBe(2)
  })

  test('counts calls for a signed non-Safe request', () => {
    expect(getCallsCount([makeRequest({ callsCount: 2, signed: ['signature'] })])).toBe(2)
  })

  test('does not count calls for a signed Safe request', () => {
    expect(
      getCallsCount([makeRequest({ callsCount: 2, isSafe: true, signed: ['signature'] })])
    ).toBe(0)
  })

  test('only excludes signed Safe calls from a mixed request list', () => {
    expect(
      getCallsCount([
        makeRequest({ callsCount: 2 }),
        makeRequest({ callsCount: 3, isSafe: true, signed: ['signature'] }),
        makeRequest({ callsCount: 1, isSafe: true })
      ])
    ).toBe(3)
  })
})
