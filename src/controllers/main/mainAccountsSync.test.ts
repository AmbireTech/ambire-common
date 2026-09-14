import { Wallet } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { makeMainController } from '../../../test/helpers/mainController'
import { suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
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

const exportPayload = async (mainCtrl: MainController, addrs: string[]) => {
  const sendUiMessage = jest.spyOn(mainCtrl.ui.message, 'sendUiMessage')

  await mainCtrl.exportAccountsForSync(addrs, true, 'request-1')

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

    test('exports nothing when no account is selected', async () => {
      const exportingDevice = await makeExportingDevice()
      const sendUiMessage = jest.spyOn(exportingDevice.ui.message, 'sendUiMessage')

      await exportingDevice.exportAccountsForSync([], true, 'request-1')

      expect(exportingDevice.emittedErrors.at(-1)?.message).toBe(
        'Select at least one account to sync.'
      )
      expect(sendUiMessage).toHaveBeenCalledWith({
        requestId: 'request-1',
        ok: false,
        error: 'Select at least one account to sync.'
      })
    })
  })
})
