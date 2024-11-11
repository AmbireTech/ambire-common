import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from './selectedAccount'

let selectedAccountCtrl: SelectedAccountController

const providers = Object.fromEntries(
  networks.map((network) => [network.id, getRpcProvider(network.rpcUrls, network.chainId)])
)

const storage: Storage = produceMemoryStore()
let providersCtrl: ProvidersController
const networksCtrl = new NetworksController(
  produceMemoryStore(),
  fetch,
  (net) => {
    providersCtrl.setProvider(net)
  },
  (id) => {
    providersCtrl.removeProvider(id)
  }
)

providersCtrl = new ProvidersController(networksCtrl)
providersCtrl.providers = providers

const accountsCtrl = new AccountsController(
  storage,
  providersCtrl,
  networksCtrl,
  () => {},
  () => {},
  () => {}
)

const accounts = [
  {
    addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
    associatedKeys: [],
    initialPrivileges: [],
    creation: {
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
    },
    preferences: {
      label: DEFAULT_ACCOUNT_LABEL,
      pfp: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    }
  }
]

describe('SelectedAccount Controller', () => {
  test('should initialize', async () => {
    await storage.set('accounts', accounts)
    selectedAccountCtrl = new SelectedAccountController({ storage, accounts: accountsCtrl })
    await selectedAccountCtrl.initialLoadPromise
    expect(selectedAccountCtrl).toBeDefined()
    expect(selectedAccountCtrl.isReady).toEqual(true)
  })
  test('should set account', async () => {
    await selectedAccountCtrl.initialLoadPromise
    expect(selectedAccountCtrl.isReady).toEqual(true)
    expect(selectedAccountCtrl.account).toBeNull()
    await selectedAccountCtrl.setAccount(accounts[0])
    expect(selectedAccountCtrl.account).not.toBe(null)
    expect(selectedAccountCtrl.account?.addr).toEqual(accounts[0].addr)
    const selectedAccountInStorage = await storage.get('selectedAccount', null)
    expect(selectedAccountInStorage).toEqual(accounts[0].addr)
  })
  test('should toJSON()', () => {
    const json = selectedAccountCtrl.toJSON()
    expect(json).toBeDefined()
  })
})
