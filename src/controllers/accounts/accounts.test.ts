import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { getRpcProvider } from '../../services/provider'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { AccountsController } from './accounts'

describe('SignMessageController', () => {
  const storage: Storage = produceMemoryStore()
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
  const providers = Object.fromEntries(
    networks.map((network) => [network.id, getRpcProvider(network.rpcUrls, network.chainId)])
  )

  let providersCtrl: ProvidersController
  const networksCtrl = new NetworksController(
    storage,
    (net) => {
      providersCtrl.setProvider(net)
    },
    (id) => {
      providersCtrl.removeProvider(id)
    }
  )
  providersCtrl = new ProvidersController(networksCtrl)
  providersCtrl.providers = providers

  let accountsCtrl: AccountsController
  test('should init ActionsController', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    ;(async () => {
      await storage.set('accounts', accounts)
      accountsCtrl = new AccountsController(storage, providersCtrl, networksCtrl, () => {})
      expect(accountsCtrl).toBeDefined()
      let emitCounter = 0
      const unsubscribe = accountsCtrl.onUpdate(() => {
        emitCounter++
        if (emitCounter === 1) {
          expect(accountsCtrl.accounts.length).toBeGreaterThan(0)
          expect(accountsCtrl.accountStates).not.toBe({})
          unsubscribe()
          done()
        }
      })
    })()
  })
  test('should select account', (done) => {
    const unsubscribe = accountsCtrl.onUpdate(() => {
      if (accountsCtrl.statuses.selectAccount === 'SUCCESS') {
        expect(accountsCtrl.selectedAccount).toEqual('0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0')
        unsubscribe()
        done()
      }
    })
    accountsCtrl.selectAccount('0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0')
  })
  test('update account preferences', (done) => {
    const unsubscribe = accountsCtrl.onUpdate(() => {
      if (accountsCtrl.statuses.updateAccountPreferences === 'SUCCESS') {
        const acc = accountsCtrl.accounts.find(
          (a) => a.addr === '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'
        )
        expect(acc?.preferences.label).toEqual('new-label')
        expect(acc?.preferences.pfp).toEqual('predefined-image')
        unsubscribe()
        done()
      }
    })
    accountsCtrl.updateAccountPreferences([
      {
        addr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
        preferences: {
          label: 'new-label',
          pfp: 'predefined-image'
        }
      }
    ])
  })
})
