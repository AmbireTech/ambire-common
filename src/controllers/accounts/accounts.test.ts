import { describe, expect, test } from '@jest/globals'

import { mockInternalKeys } from '../../../test/helpers'
import { makeMainController } from '../../../test/helpers/mainController'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { IAccountsController } from '../../interfaces/account'

const accounts = [
  {
    addr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
    associatedKeys: ['0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'],
    initialPrivileges: [],
    creation: null,
    preferences: {
      label: DEFAULT_ACCOUNT_LABEL,
      pfp: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'
    }
  },
  {
    addr: '0x71c3D24a627f0416db45107353d8d0A5ae0401ae',
    associatedKeys: ['0x71c3D24a627f0416db45107353d8d0A5ae0401ae'],
    initialPrivileges: [],
    creation: null,
    preferences: {
      label: DEFAULT_ACCOUNT_LABEL,
      pfp: '0x71c3D24a627f0416db45107353d8d0A5ae0401ae'
    }
  }
]

describe('AccountsController', () => {
  let accountsCtrl: IAccountsController

  test('should init AccountsController', async () => {
    const mockKeys = mockInternalKeys(accounts)
    const { mainCtrl } = await makeMainController(
      async (storageCtrl) => {
        await storageCtrl.set('accounts', accounts)
        await storageCtrl.set('selectedAccount', accounts[0]!.addr)
        await storageCtrl.set('keystoreKeys', mockKeys)
      },
      { skipAccountStateLoad: false }
    )

    accountsCtrl = mainCtrl.accounts

    expect(accountsCtrl).toBeDefined()

    expect(accountsCtrl.areAccountStatesLoading).toBe(false)
  })
  test('update account preferences', async () => {
    await accountsCtrl.updateAccountPreferences([
      {
        addr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
        preferences: {
          label: 'new-label',
          pfp: 'predefined-image'
        }
      }
    ])

    const acc = accountsCtrl.accounts.find(
      (a) => a.addr === '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'
    )
    expect(acc?.preferences.label).toEqual('new-label')
    expect(acc?.preferences.pfp).toEqual('predefined-image')
  })
  test('removeAccountData', async () => {
    await accountsCtrl.updateAccountState(accounts[0]!.addr)
    expect(accountsCtrl.accounts.length).toBeGreaterThan(0)
    expect(Object.keys(accountsCtrl.accountStates).length).toBeGreaterThan(0)
    expect(accountsCtrl.areAccountStatesLoading).toBe(false)

    accountsCtrl.removeAccountData('0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0')

    accountsCtrl.removeAccountData('0x71c3D24a627f0416db45107353d8d0A5ae0401ae')

    expect(accountsCtrl.accounts.length).toEqual(0)
    expect(Object.keys(accountsCtrl.accountStates).length).toEqual(0)
  })
})
