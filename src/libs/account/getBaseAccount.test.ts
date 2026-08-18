import { describe, expect, test } from '@jest/globals'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { EOA } from './EOA'
import { EOA7702 } from './EOA7702'
import { getBaseAccount } from './getBaseAccount'

const accountAddr = '0x1111111111111111111111111111111111111111'

const account = {
  addr: accountAddr,
  associatedKeys: [accountAddr],
  initialPrivileges: [],
  creation: null,
  preferences: { label: 'Account', pfp: accountAddr }
} as Account

const network = {
  chainId: 1n,
  has7702: true
} as Network

const accountState = {
  isEOA: true,
  isSmarterEoa: false,
  importedAccountKeys: [
    {
      addr: accountAddr,
      type: 'internal',
      label: 'Account key',
      dedicatedToOneSA: false,
      isExternallyStored: false,
      meta: { createdAt: null }
    }
  ]
} as AccountOnchainState

describe('getBaseAccount', () => {
  test('returns an EOA7702 when the account is eligible and ERC-7702 is enabled', () => {
    expect(getBaseAccount(account, accountState, network, true, true)).toBeInstanceOf(EOA7702)
  })

  test('keeps ERC-7702 enabled when the setting has not been provided yet', () => {
    expect(getBaseAccount(account, accountState, network, true, true)).toBeInstanceOf(EOA7702)
  })

  test('returns an EOA when the account is eligible but ERC-7702 is disabled', () => {
    expect(getBaseAccount(account, accountState, network, true, false)).toBeInstanceOf(EOA)
  })

  test('returns an EOA for an existing onchain delegation when ERC-7702 is disabled', () => {
    const delegatedAccountState = { ...accountState, isSmarterEoa: true }

    expect(getBaseAccount(account, delegatedAccountState, network, true, false)).toBeInstanceOf(EOA)
  })

  test('returns an EOA when the network does not support ERC-7702', () => {
    const networkWithout7702 = { ...network, has7702: false }

    expect(getBaseAccount(account, accountState, networkWithout7702, true, true)).toBeInstanceOf(
      EOA
    )
  })
})
