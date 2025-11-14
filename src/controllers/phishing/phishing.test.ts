import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { relayerUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { mockUiManager } from '../../../test/helpers/ui'
import { networks } from '../../consts/networks'
import { IPhishingController } from '../../interfaces/phishing'
import { IProvidersController } from '../../interfaces/provider'
import { Storage } from '../../interfaces/storage'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { AddressBookController } from '../addressBook/addressBook'
import { AutoLoginController } from '../autoLogin/autoLogin'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { PhishingController } from './phishing'

const providers = Object.fromEntries(
  networks.map((network) => [network.chainId, getRpcProvider(network.rpcUrls, network.chainId)])
)

const storage: Storage = produceMemoryStore()
const storageCtrl = new StorageController(storage)
let providersCtrl: IProvidersController
const networksCtrl = new NetworksController({
  storage: storageCtrl,
  fetch,
  relayerUrl,
  onAddOrUpdateNetworks: (nets) => {
    nets.forEach((n) => {
      providersCtrl.setProvider(n)
    })
  },
  onRemoveNetwork: (id) => {
    providersCtrl.removeProvider(id)
  }
})
providersCtrl = new ProvidersController(networksCtrl)
providersCtrl.providers = providers
const { uiManager } = mockUiManager()
const uiCtrl = new UiController({ uiManager })
const keystore = new KeystoreController('default', storageCtrl, {}, uiCtrl)
const accountsCtrl = new AccountsController(
  storageCtrl,
  providersCtrl,
  networksCtrl,
  keystore,
  () => {},
  () => {},
  () => {},
  relayerUrl,
  fetch
)
const autoLoginCtrl = new AutoLoginController(
  storageCtrl,
  keystore,
  providersCtrl,
  networksCtrl,
  accountsCtrl,
  {},
  new InviteController({ relayerUrl, fetch, storage: storageCtrl })
)
const selectedAccountCtrl = new SelectedAccountController({
  storage: storageCtrl,
  accounts: accountsCtrl,
  keystore,
  autoLogin: autoLoginCtrl
})
const addressBookCtrl = new AddressBookController(storageCtrl, accountsCtrl, selectedAccountCtrl)

let phishing: IPhishingController

describe('PhishingController', () => {
  beforeEach(async () => {
    await storageCtrl.set('dappsBlacklistedStatus', {
      'foourmemez.com': {
        status: 'BLACKLISTED',
        updatedAt: Date.now()
      },
      'rewards.ambire.com': {
        status: 'VERIFIED',
        updatedAt: Date.now()
      }
    })
    await storageCtrl.set('addressesBlacklistedStatus', {
      '0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e': {
        status: 'BLACKLISTED',
        updatedAt: Date.now()
      },
      '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': {
        status: 'VERIFIED',
        updatedAt: Date.now()
      }
    })
    phishing = new PhishingController({ fetch, storage: storageCtrl, addressBook: addressBookCtrl })
    await phishing.initialLoadPromise
  })
  test('should initialize', async () => {
    expect(phishing).toBeDefined()
  })
  test('should get dapps blacklisted status', async () => {
    phishing.updateDappsBlacklistedStatus(
      ['foourmemez.com', 'rewards.ambire.com'],
      (blacklistedStatus) => {
        expect(blacklistedStatus['foourmemez.com'] === 'BLACKLISTED')
        expect(blacklistedStatus['rewards.ambire.com'] === 'VERIFIED')
      }
    )
  })
  test('should get addresses blacklisted status', async () => {
    await phishing.updateAddressesBlacklistedStatus(
      ['0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e', '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'],
      (blacklistedStatus) => {
        expect(blacklistedStatus['0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e'] === 'BLACKLISTED')
        expect(blacklistedStatus['0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'] === 'VERIFIED')
      }
    )
  })
})
