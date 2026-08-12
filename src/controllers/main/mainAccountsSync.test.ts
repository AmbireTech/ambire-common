import { Wallet } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { makeMainController } from '../../../test/helpers/mainController'
import { suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
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

const accounts = [
  toAccount(firstWallet.address, 'Account 1'),
  toAccount(secondWallet.address, DEFAULT_ACCOUNT_LABEL)
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

  return mainCtrl
}

const makeImportingDevice = async ({ withPassword }: { withPassword: boolean }) => {
  const { mainCtrl } = await makeMainController()

  if (withPassword) await mainCtrl.keystore.addSecret('password', IMPORTING_PASS, '', true)

  return mainCtrl
}

const exportPayload = async (mainCtrl: MainController, addrs: string[]) => {
  const sendUiMessage = jest.spyOn(mainCtrl.ui.message, 'sendUiMessage')

  await mainCtrl.exportAccountsForSync(addrs)

  const { accountsSyncPayload } = (sendUiMessage.mock.calls[0]?.[0] || {}) as {
    accountsSyncPayload?: string
  }
  sendUiMessage.mockRestore()

  return accountsSyncPayload as string
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
    expect(importingDevice.accounts.accounts).toHaveLength(2)
    expect(importingDevice.keystore.keys).toHaveLength(0)

    await importingDevice.keystore.addSecret('password', IMPORTING_PASS, '', true)

    expect(importingDevice.keystore.keys.map((k) => k.addr)).toEqual(accounts.map((a) => a.addr))
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

      await exportingDevice.exportAccountsForSync([])

      expect(exportingDevice.emittedErrors.at(-1)?.message).toBe(
        'Select at least one account to sync.'
      )
      expect(sendUiMessage).not.toHaveBeenCalled()
    })
  })
})
