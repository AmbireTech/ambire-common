import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { relayerUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { mockUiManager } from '../../../test/helpers/ui'
import { predefinedDapps } from '../../consts/dapps/dapps'
import { networks } from '../../consts/networks'
import { IProvidersController } from '../../interfaces/provider'
import { IStorageController, Storage } from '../../interfaces/storage'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { AddressBookController } from '../addressBook/addressBook'
import { AutoLoginController } from '../autoLogin/autoLogin'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PhishingController } from '../phishing/phishing'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { DappsController } from './dapps'

const prepareTest = async (
  storageInit?: (storageController: IStorageController) => Promise<void>
) => {
  const providers = Object.fromEntries(
    networks.map((network) => [network.chainId, getRpcProvider(network.rpcUrls, network.chainId)])
  )

  const storage: Storage = produceMemoryStore()
  const storageCtrl = new StorageController(storage)

  !!storageInit && (await storageInit(storageCtrl))

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

  const phishingCtrl = new PhishingController({
    fetch,
    storage: storageCtrl,
    addressBook: addressBookCtrl
  })
  const controller = new DappsController({
    fetch,
    appVersion: '1.0.0',
    storage: storageCtrl,
    networks: networksCtrl,
    phishing: phishingCtrl,
    ui: uiCtrl
  })
  await controller.initialLoadPromise

  return { controller }
}

describe('DappsController', () => {
  test('should initialize', async () => {
    const { controller } = await prepareTest()
    expect(controller).toBeDefined()
  })
  test('should fetch and update dapps', async () => {
    const { controller } = await prepareTest(async (storageCtrl) => {
      await storageCtrl.set('dappsV2', predefinedDapps)
      await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
    })
    expect(controller.dapps).toHaveLength(predefinedDapps.length)
    expect(controller.isReadyToDisplayDapps).toBe(false) // fetch and update is already running
  })
})
