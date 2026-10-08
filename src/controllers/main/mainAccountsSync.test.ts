import { Wallet } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { makeMainController } from '../../../test/helpers/mainController'
import { suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { AccountsSyncExportOptions } from '../../libs/accountsSync/accountsSync'
import { MainController } from './main'

const EXPORTING_PASS = 'exportingDevicePass'
const IMPORTING_PASS = 'importingDevicePass'

const firstWallet = Wallet.createRandom()
const secondWallet = Wallet.createRandom()

const toAccount = (addr: string, label: string) => ({
  addr,
  associatedKeys: [addr],
  initialPrivileges: [],
  creation: null,
  preferences: { label, pfp: addr }
})

const VIEW_ONLY_ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const RENAMED_CONTACT_ADDR = '0x64c5f3c58E024170166F85aFE6e291088a2c2968'
const NEW_CONTACT_ADDR = '0x085f8A348f6fBc6F8d8FC3f1e427473436506D65'
const UNTOUCHED_CONTACT_ADDR = '0x8DC9b3e1F5b0Dc9F6b2e0d3D0Ba0A5a32B0E7C4B'
const LEDGER_ADDR = '0x1A2C3802A9eC12725678dAF23DbFD13134e5893A'

const accounts = [
  toAccount(firstWallet.address, 'Account 1'),
  toAccount(secondWallet.address, DEFAULT_ACCOUNT_LABEL),
  toAccount(VIEW_ONLY_ADDR, 'Watched account'),
  toAccount(LEDGER_ADDR, 'Ledger account')
]

const makeExportingDevice = async () => {
  const { mainCtrl } = await makeMainController(async (storageCtrl) => {
    await storageCtrl.set('accounts', accounts)
    await storageCtrl.set('selectedAccount', accounts[0]!.addr)
  })

  await mainCtrl.keystore.addSecret('password', EXPORTING_PASS, '', true)
  await mainCtrl.keystore.addKeys(
    [firstWallet, secondWallet].map((wallet, i) => ({
      addr: wallet.address,
      label: `Key ${i + 1}`,
      type: 'internal' as const,
      privateKey: wallet.privateKey,
      dedicatedToOneSA: false,
      meta: { createdAt: new Date().getTime() }
    }))
  )
  await mainCtrl.keystore.addKeysExternallyStored([
    {
      addr: LEDGER_ADDR,
      label: 'Ledger Key 1',
      type: 'ledger',
      dedicatedToOneSA: false,
      meta: {
        deviceId: '1',
        deviceModel: 'nanoX',
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
        index: 0,
        createdAt: new Date().getTime()
      }
    }
  ])

  return mainCtrl
}

const makeImportingDevice = async ({ withPassword }: { withPassword: boolean }) => {
  const { mainCtrl } = await makeMainController()

  if (withPassword) await mainCtrl.keystore.addSecret('password', IMPORTING_PASS, '', true)

  return mainCtrl
}

const ACCOUNTS_ONLY: AccountsSyncExportOptions = {
  includeSeeds: true,
  includeNetworks: false,
  includeContacts: false
}

const exportPayload = async (
  mainCtrl: MainController,
  addrs: string[],
  options: AccountsSyncExportOptions = ACCOUNTS_ONLY
) => {
  const sendUiMessage = jest.spyOn(mainCtrl.ui.message, 'sendUiMessage')

  await mainCtrl.exportAccountsForSync(addrs, options, 'request-1')

  const response = (sendUiMessage.mock.calls[0]?.[0] || {}) as { ok?: boolean; res?: string }
  sendUiMessage.mockRestore()

  expect(response.ok).toBe(true)

  return response.res as string
}

describe('MainController accounts sync', () => {
  test('exports only the selected accounts and imports them on the other device', async () => {
    const exportingDevice = await makeExportingDevice()
    const payload = await exportPayload(exportingDevice, [accounts[0]!.addr])

    const importingDevice = await makeImportingDevice({ withPassword: true })
    await importingDevice.importAccountsFromSync({ payload, password: EXPORTING_PASS })

    expect(importingDevice.accounts.accounts.map((a) => a.addr)).toEqual([accounts[0]!.addr])
    // Preferences travel along, so the account looks the same on both devices
    expect(importingDevice.accounts.accounts[0]!.preferences.label).toBe('Account 1')
    // The key is re-encrypted with the importing device's main key, so it can sign
    const signer = await importingDevice.keystore.getSigner(accounts[0]!.addr, 'internal')
    expect(signer.key.addr).toBe(accounts[0]!.addr)
  })

  test('imports accounts scanned before the device password was set (onboarding)', async () => {
    const exportingDevice = await makeExportingDevice()
    const payload = await exportPayload(
      exportingDevice,
      accounts.map((a) => a.addr)
    )

    const importingDevice = await makeImportingDevice({ withPassword: false })
    await importingDevice.importAccountsFromSync({ payload, password: EXPORTING_PASS })

    // The accounts are already there, the keys wait for a main key to be encrypted with
    expect(importingDevice.accounts.accounts).toHaveLength(accounts.length)
    expect(importingDevice.keystore.keys).toHaveLength(0)

    await importingDevice.keystore.addSecret('password', IMPORTING_PASS, '', true)

    // Every account that has a key on the other device can sign on this one as well
    expect(importingDevice.keystore.keys.map((k) => k.addr)).toEqual([
      firstWallet.address,
      secondWallet.address,
      LEDGER_ADDR
    ])
  })

  test('syncs an account that has no keys at all', async () => {
    const exportingDevice = await makeExportingDevice()
    const payload = await exportPayload(exportingDevice, [VIEW_ONLY_ADDR])

    const importingDevice = await makeImportingDevice({ withPassword: true })
    await importingDevice.importAccountsFromSync({ payload, password: EXPORTING_PASS })

    expect(importingDevice.accounts.accounts.map((a) => a.addr)).toEqual([VIEW_ONLY_ADDR])
    // It stays a watched account on this device too
    expect(importingDevice.keystore.keys).toHaveLength(0)
  })

  test('syncs an account controlled by a hardware wallet, without a private key to move', async () => {
    const exportingDevice = await makeExportingDevice()
    const payload = await exportPayload(exportingDevice, [LEDGER_ADDR])

    const importingDevice = await makeImportingDevice({ withPassword: true })
    await importingDevice.importAccountsFromSync({ payload, password: EXPORTING_PASS })

    expect(importingDevice.accounts.accounts.map((a) => a.addr)).toEqual([LEDGER_ADDR])
    expect(importingDevice.keystore.keys).toEqual([
      expect.objectContaining({ addr: LEDGER_ADDR, type: 'ledger', isExternallyStored: true })
    ])
  })

  test('does not duplicate an account the other device already has', async () => {
    const exportingDevice = await makeExportingDevice()
    const payload = await exportPayload(exportingDevice, [accounts[0]!.addr])

    const importingDevice = await makeImportingDevice({ withPassword: true })
    await importingDevice.importAccountsFromSync({ payload, password: EXPORTING_PASS })
    await importingDevice.importAccountsFromSync({ payload, password: EXPORTING_PASS })

    expect(importingDevice.accounts.accounts).toHaveLength(1)
    expect(importingDevice.keystore.keys).toHaveLength(1)
  })

  test('merges the settings, networks and contacts the user chose to sync', async () => {
    const exportingDevice = await makeExportingDevice()
    const [ethereum, otherNetwork] = exportingDevice.networks.allNetworks
    await exportingDevice.networks.mergeNetworks([
      { ...ethereum!, rpcUrls: [...ethereum!.rpcUrls, 'https://synced.example'] },
      { ...otherNetwork!, disabled: false }
    ])
    await exportingDevice.featureFlags.setFeatureFlags({
      gasTank: false,
      erc4337: false,
      tokenPrices: false,
      ledgerSigningReports: true
    })
    await exportingDevice.addressBook.addContact('New name', RENAMED_CONTACT_ADDR)
    await exportingDevice.addressBook.addContact('Bob', NEW_CONTACT_ADDR)

    const payload = await exportPayload(exportingDevice, [accounts[0]!.addr], {
      includeSeeds: true,
      appSettings: { themeType: 'dark' },
      includeNetworks: true,
      includeContacts: true
    })

    const importingDevice = await makeImportingDevice({ withPassword: true })
    await importingDevice.featureFlags.setFeatureFlags({ testnetMode: true })
    await importingDevice.networks.mergeNetworks([{ ...otherNetwork!, disabled: true }])
    // The Address Book has no contacts without a selected account
    await importingDevice.accounts.addAccounts([accounts[3]!])
    await importingDevice.selectedAccount.setAccount(importingDevice.accounts.accounts[0]!)
    await importingDevice.addressBook.addContact('Old name', RENAMED_CONTACT_ADDR)
    await importingDevice.addressBook.addContact('Carol', UNTOUCHED_CONTACT_ADDR)

    await importingDevice.importAccountsFromSync({ payload, password: EXPORTING_PASS })

    const findNetwork = (chainId: bigint) =>
      importingDevice.networks.allNetworks.find((n) => n.chainId === chainId)
    expect(findNetwork(ethereum!.chainId)?.rpcUrls).toContain('https://synced.example')
    // The exporting device has it enabled, so the synced copy overrides this one
    expect(findNetwork(otherNetwork!.chainId)?.disabled).toBeFalsy()

    expect(importingDevice.featureFlags.flags).toMatchObject({
      gasTank: false,
      erc4337: false,
      tokenPrices: false,
      ledgerSigningReports: true,
      // Not a privacy opt-out, so it stays as this device has it
      testnetMode: true
    })

    const contactNames = Object.fromEntries(
      importingDevice.addressBook.contacts
        .filter((c) => !c.isWalletAccount)
        .map((c) => [c.address, c.name])
    )
    expect(contactNames).toEqual({
      [RENAMED_CONTACT_ADDR]: 'New name',
      [NEW_CONTACT_ADDR]: 'Bob',
      [UNTOUCHED_CONTACT_ADDR]: 'Carol'
    })
  })

  test('syncs the settings, networks and contacts without any accounts or a password', async () => {
    const exportingDevice = await makeExportingDevice()
    await exportingDevice.featureFlags.setFeatureFlags({ ledgerSigningReports: true })
    await exportingDevice.addressBook.addContact('Bob', NEW_CONTACT_ADDR)
    const payload = await exportPayload(exportingDevice, [], {
      includeSeeds: true,
      appSettings: { themeType: 'dark' },
      includeNetworks: true,
      includeContacts: true
    })

    // A device still on the get started screen: no accounts and no password yet
    const importingDevice = await makeImportingDevice({ withPassword: false })
    await importingDevice.importAccountsFromSync({ payload })

    expect(importingDevice.statuses.importAccountsFromSync).toBe('INITIAL')
    expect(importingDevice.emittedErrors).toHaveLength(0)
    expect(importingDevice.accounts.accounts).toHaveLength(0)
    expect(importingDevice.keystore.keys).toHaveLength(0)
    expect(importingDevice.featureFlags.flags.ledgerSigningReports).toBe(true)
    // The Address Book lists nothing without a selected account, so this reads storage
    expect(await importingDevice.storage.get('contacts', [])).toEqual([
      expect.objectContaining({ name: 'Bob', address: NEW_CONTACT_ADDR })
    ])
  })

  test('syncs a hardware wallet account without asking for a password', async () => {
    const exportingDevice = await makeExportingDevice()
    const payload = await exportPayload(exportingDevice, [LEDGER_ADDR])

    const importingDevice = await makeImportingDevice({ withPassword: true })
    await importingDevice.importAccountsFromSync({ payload })

    expect(importingDevice.accounts.accounts.map((a) => a.addr)).toEqual([LEDGER_ADDR])
    expect(importingDevice.keystore.keys.map((k) => k.addr)).toEqual([LEDGER_ADDR])
  })

  test('sends no settings, networks or contacts unless the user chose them', async () => {
    const exportingDevice = await makeExportingDevice()
    await exportingDevice.featureFlags.setFeatureFlags({ ledgerSigningReports: true })
    await exportingDevice.addressBook.addContact('Bob', NEW_CONTACT_ADDR)
    const payload = await exportPayload(exportingDevice, [accounts[0]!.addr])

    const importingDevice = await makeImportingDevice({ withPassword: true })
    await importingDevice.importAccountsFromSync({ payload, password: EXPORTING_PASS })

    expect(importingDevice.featureFlags.flags.ledgerSigningReports).toBe(false)
    expect(importingDevice.addressBook.contacts.filter((c) => !c.isWalletAccount)).toEqual([])
  })

  describe('Negative cases', () => {
    suppressConsoleBeforeEach()

    test('adds no accounts when the password of the other device is wrong', async () => {
      const exportingDevice = await makeExportingDevice()
      const payload = await exportPayload(exportingDevice, [accounts[0]!.addr])

      const importingDevice = await makeImportingDevice({ withPassword: true })
      await importingDevice.importAccountsFromSync({ payload, password: 'wrongPass' })

      expect(importingDevice.emittedErrors.at(-1)?.message).toBe(
        'Incorrect password. Please try again.'
      )
      expect(importingDevice.accounts.accounts).toHaveLength(0)
      expect(importingDevice.keystore.keys).toHaveLength(0)
    })

    test('adds no accounts when the scanned data is not a sync payload', async () => {
      const importingDevice = await makeImportingDevice({ withPassword: true })

      await importingDevice.importAccountsFromSync({
        payload: '0x010203',
        password: IMPORTING_PASS
      })

      expect(importingDevice.emittedErrors.at(-1)?.message).toContain(
        'do not contain Ambire accounts'
      )
      expect(importingDevice.accounts.accounts).toHaveLength(0)
    })

    test('exports nothing when nothing is selected', async () => {
      const exportingDevice = await makeExportingDevice()
      const sendUiMessage = jest.spyOn(exportingDevice.ui.message, 'sendUiMessage')

      await exportingDevice.exportAccountsForSync([], ACCOUNTS_ONLY, 'request-1')

      expect(exportingDevice.emittedErrors.at(-1)?.message).toBe('Select what you want to sync.')
      expect(sendUiMessage).toHaveBeenCalledWith({
        requestId: 'request-1',
        ok: false,
        error: 'Select what you want to sync.'
      })
    })
  })
})
