import { describe, expect, test } from '@jest/globals'

import { Key } from '../interfaces/keystore'
import { canPayFeeForOtherAccounts } from './accounts'

const ACCOUNT_ADDR = '0x1111111111111111111111111111111111111111'
const OTHER_ADDR = '0x2222222222222222222222222222222222222222'

const keyOf = (type: Key['type'], addr = ACCOUNT_ADDR) => ({ addr, type }) as Key

describe('canPayFeeForOtherAccounts', () => {
  test('an account with a key that signs plain transactions can pay', () => {
    expect(canPayFeeForOtherAccounts([keyOf('internal')], [ACCOUNT_ADDR])).toBe(true)
    expect(canPayFeeForOtherAccounts([keyOf('ledger')], [ACCOUNT_ADDR])).toBe(true)
  })

  test('a view-only account cannot pay', () => {
    expect(canPayFeeForOtherAccounts([], [ACCOUNT_ADDR])).toBe(false)
    expect(canPayFeeForOtherAccounts([keyOf('internal', OTHER_ADDR)], [ACCOUNT_ADDR])).toBe(false)
  })

  test('a PQ1 account cannot pay: it sends only its own transactions', () => {
    expect(canPayFeeForOtherAccounts([keyOf('pq1')], [ACCOUNT_ADDR])).toBe(false)
  })
})
