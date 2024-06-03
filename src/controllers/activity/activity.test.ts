import { describe, expect } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { AccountStates } from '../../interfaces/account'
import { SettingsController } from '../settings/settings'
import { ActivityController, SignedMessage, SubmittedAccountOp } from './activity'

const INIT_PARAMS = {
  selectedAccount: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  filters: {
    account: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
    network: 'ethereum'
  }
}

describe('Activity Controller ', () => {
  const accounts = {
    '0xa07D75aacEFd11b425AF7181958F0F85c312f143': {
      ethereum: {
        accountAddr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
        nonce: 379n,
        isDeployed: true,
        associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
        isV2: false,
        scheduledRecoveries: [],
        balance: 0n,
        isEOA: false,
        deployError: false
      }
    },
    '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5': {
      ethereum: {
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        nonce: 225n,
        isDeployed: true,
        associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
        isV2: true,
        scheduledRecoveries: [],
        balance: 0n,
        isEOA: false,
        deployError: false
      }
    }
  } as unknown as AccountStates

  describe('AccountsOps', () => {
    test('Retrieved from Controller and persisted in Storage', async () => {
      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      const controller = new ActivityController(storage, accounts, settings)

      controller.init(INIT_PARAMS)

      const accountOp = {
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'ethereum',
        nonce: 225n,
        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        calls: [
          {
            to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
            value: BigInt(0),
            data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
          }
        ],
        txnId: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb',
        status: 'broadcasted-but-not-confirmed'
      } as SubmittedAccountOp

      await controller.addAccountOp(accountOp)
      const controllerAccountsOps = controller.accountsOps
      const storageAccountsOps = await storage.get('accountsOps', {})

      expect(controllerAccountsOps).toEqual({
        items: [{ ...accountOp, status: 'broadcasted-but-not-confirmed' }], // everytime we add a new AccountOp, it gets broadcasted-but-not-confirmed status
        itemsTotal: 1,
        currentPage: 0,
        maxPages: 1
      })
      expect(storageAccountsOps['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum).toEqual([
        { ...accountOp, status: 'broadcasted-but-not-confirmed' }
      ])
    })

    test('Pagination and filtration handled correctly', async () => {
      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      const controller = new ActivityController(storage, accounts, settings)

      controller.init(INIT_PARAMS)

      const accountsOps = [
        {
          accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
          signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
          gasLimit: null,
          gasFeePayment: null,
          networkId: 'ethereum',
          nonce: 225n,
          signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
          calls: [
            {
              to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
              value: BigInt(0),
              data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
            }
          ],
          txnId: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb',
          status: 'broadcasted-but-not-confirmed'
        },
        {
          accountAddr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
          signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
          gasLimit: null,
          gasFeePayment: null,
          networkId: 'ethereum',
          nonce: 225n,
          signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
          calls: [
            {
              to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
              value: BigInt(0),
              data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
            }
          ],
          txnId: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb',
          status: 'broadcasted-but-not-confirmed'
        },
        {
          accountAddr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
          signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
          gasLimit: null,
          gasFeePayment: null,
          networkId: 'optimism',
          nonce: 225n,
          signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
          calls: [
            {
              to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
              value: BigInt(0),
              data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
            }
          ],
          txnId: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb',
          status: 'broadcasted-but-not-confirmed'
        },
        {
          accountAddr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
          signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
          gasLimit: null,
          gasFeePayment: null,
          networkId: 'optimism',
          nonce: 225n,
          signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
          calls: [
            {
              to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
              value: BigInt(0),
              data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
            }
          ],
          txnId: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb',
          status: 'broadcasted-but-not-confirmed'
        }
      ] as SubmittedAccountOp[]

      // eslint-disable-next-line no-restricted-syntax
      for (const accountOp of accountsOps) {
        // eslint-disable-next-line no-await-in-loop
        await controller.addAccountOp(accountOp)
      }

      // For the following criteria, we have 2 matching AccountsOps, these will be paginated on 2 pages (1 AccountOp per page)
      await controller.setAccountsOpsPagination({ fromPage: 1, itemsPerPage: 1 })
      await controller.setFilters({
        account: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
        network: 'optimism'
      })

      const controllerAccountsOps = controller.accountsOps

      expect(controllerAccountsOps).toEqual({
        items: [
          {
            accountAddr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
            signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
            gasLimit: null,
            gasFeePayment: null,
            networkId: 'optimism',
            nonce: 225n,
            signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
            calls: [
              {
                to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
                value: BigInt(0),
                data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
              }
            ],
            status: 'broadcasted-but-not-confirmed', // everytime we add a new AccountOp, it gets broadcasted-but-not-confirmed status
            txnId: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb'
          }
        ],
        itemsTotal: 2,
        currentPage: 1, // index based
        maxPages: 2
      })
    })

    test('`success` status is set correctly', async () => {
      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      const controller = new ActivityController(storage, accounts, settings)

      controller.init(INIT_PARAMS)

      const accountOp = {
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'ethereum',
        nonce: 225n,
        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        calls: [
          {
            to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
            value: BigInt(0),
            data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
          }
        ],
        // this txn is already mined and has `success` status
        txnId: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb',
        status: 'broadcasted-but-not-confirmed'
      } as SubmittedAccountOp

      await controller.addAccountOp(accountOp)
      await controller.updateAccountsOpsStatuses()
      const controllerAccountsOps = controller.accountsOps

      expect(controllerAccountsOps).toEqual({
        items: [{ ...accountOp, status: 'success' }], //  we expect success here
        itemsTotal: 1,
        currentPage: 0,
        maxPages: 1
      })
    })

    test('`failed` status is set correctly', async () => {
      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      const controller = new ActivityController(storage, accounts, settings)

      controller.init(INIT_PARAMS)

      const accountOp = {
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'ethereum',
        nonce: 225n,
        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        calls: [
          {
            to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
            value: BigInt(0),
            data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
          }
        ],
        // this txn is already mined, but has `fail` status
        txnId: '0x67ec3acc5274a88c50d1e79e9b9d4c2c3d5e0e3ba3cc33b32d65f3fdb3b5a258',
        status: 'broadcasted-but-not-confirmed'
      } as SubmittedAccountOp

      await controller.addAccountOp(accountOp)
      await controller.updateAccountsOpsStatuses()
      const controllerAccountsOps = controller.accountsOps

      expect(controllerAccountsOps).toEqual({
        items: [{ ...accountOp, status: 'failure' }], // we expect failure here
        itemsTotal: 1,
        currentPage: 0,
        maxPages: 1
      })
    })

    test('`Unknown but past nonce` status is set correctly', async () => {
      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      const controller = new ActivityController(storage, accounts, settings)

      controller.init({
        selectedAccount: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
        filters: {
          account: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
          network: 'ethereum'
        }
      })

      const accountOp = {
        accountAddr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'ethereum',
        nonce: 225n,
        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        calls: [
          {
            to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
            value: BigInt(0),
            data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
          }
        ],
        // wrong txn id, so we can simulate nullish getTransactionReceipt()
        txnId: '0x0000000000000000000000000000000000000000000000000000000000000001',
        status: 'broadcasted-but-not-confirmed'
      } as SubmittedAccountOp

      await controller.addAccountOp(accountOp)
      await controller.updateAccountsOpsStatuses()
      const controllerAccountsOps = controller.accountsOps

      expect(controllerAccountsOps).toEqual({
        items: [{ ...accountOp, status: 'unknown-but-past-nonce' }], // we expect unknown-but-past-nonce status here
        itemsTotal: 1,
        currentPage: 0,
        maxPages: 1
      })
    })

    test('Keeps no more than 1000 items', async () => {
      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      const controller = new ActivityController(storage, accounts, settings)

      controller.init(INIT_PARAMS)

      const accountOp = {
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'ethereum',
        nonce: 225n,
        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        calls: [
          {
            to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
            value: BigInt(0),
            data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
          }
        ],
        txnId: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb',
        status: 'broadcasted-but-not-confirmed'
      } as SubmittedAccountOp

      const accountsOps = Array.from(Array(1500).keys()).map((key) => ({
        ...accountOp,
        nonce: BigInt(key)
      }))

      // eslint-disable-next-line no-restricted-syntax
      for (const ao of accountsOps) {
        // eslint-disable-next-line no-await-in-loop
        await controller.addAccountOp(ao)
      }

      await controller.setAccountsOpsPagination({ fromPage: 0, itemsPerPage: 1000 })
      const controllerAccountsOps = controller.accountsOps
      expect(controllerAccountsOps!.itemsTotal).toEqual(1000)
      // newest added item will be added to the beginning of the array
      // in this case newest item is with nonce 1499n and should be at index 0
      expect(controllerAccountsOps!.items[0].nonce).toEqual(1499n)
      expect(controllerAccountsOps!.items[999].nonce).toEqual(500n)
    })
  })

  describe('SignedMessages', () => {
    test('Retrieved from Controller and persisted in Storage', async () => {
      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      const controller = new ActivityController(storage, accounts, settings)

      controller.init(INIT_PARAMS)

      const signedMessage: SignedMessage = {
        fromActionId: 1,
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        dapp: {
          icon: '',
          name: 'dapp-name'
        },
        timestamp: 1701345600000,
        content: {
          kind: 'message',
          message: '0x74657374'
        },

        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        networkId: 'ethereum'
      }

      await controller.addSignedMessage(signedMessage, '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5')
      const controllerSignedMessages = controller.signedMessages
      const storageSignedMessages = await storage.get('signedMessages', {})

      expect(controllerSignedMessages).toEqual({
        items: [signedMessage],
        itemsTotal: 1,
        currentPage: 0,
        maxPages: 1
      })
      expect(storageSignedMessages['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']).toEqual([
        signedMessage
      ])
    })

    test('Pagination and filtration handled correctly', async () => {
      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      const controller = new ActivityController(storage, accounts, settings)

      controller.init(INIT_PARAMS)

      const signedMessage: SignedMessage = {
        fromActionId: 1,
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        dapp: {
          icon: '',
          name: 'dapp-name'
        },
        timestamp: 1701345600000,
        content: {
          kind: 'message',
          message: '0x74657374'
        },
        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        networkId: 'ethereum'
      }

      await controller.addSignedMessage(signedMessage, '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5')
      await controller.addSignedMessage(signedMessage, '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5')
      await controller.addSignedMessage(signedMessage, '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5')

      // For the following criteria, we have 2 matching SignedMessages, these will be paginated on 2 pages (1 Message per page)
      await controller.setSignedMessagesPagination({ fromPage: 1, itemsPerPage: 1 })
      await controller.setFilters({
        account: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        network: 'optimism'
      })

      const controllerSignedMessages = controller.signedMessages

      expect(controllerSignedMessages).toEqual({
        items: [signedMessage],
        itemsTotal: 3,
        currentPage: 1, // index based
        maxPages: 3
      })
    })

    test('Keeps no more than 1000 items', async () => {
      const storage = produceMemoryStore()
      const settings = new SettingsController(storage)
      const controller = new ActivityController(storage, accounts, settings)

      controller.init(INIT_PARAMS)

      const signedMessage: SignedMessage = {
        fromActionId: 1,
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        dapp: {
          icon: '',
          name: 'dapp-name'
        },
        timestamp: 1701345600000,
        content: {
          kind: 'message',
          message: '0x123456'
        },
        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        networkId: 'ethereum'
      }

      const signedMessages = Array.from(Array(1500).keys()).map((key) => ({
        ...signedMessage,
        signature: key.toString()
      }))

      // eslint-disable-next-line no-restricted-syntax
      for (const sm of signedMessages) {
        // eslint-disable-next-line no-await-in-loop
        await controller.addSignedMessage(sm, '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5')
      }

      await controller.setSignedMessagesPagination({ fromPage: 0, itemsPerPage: 1000 })
      const controllerSignedMessages = controller.signedMessages

      expect(controllerSignedMessages!.itemsTotal).toEqual(1000)
      // newest added item will be added to the beginning of the array
      // in this case newest item is with signature 1499 and should be at index 0
      expect(controllerSignedMessages!.items[0].signature).toEqual('1499')
      expect(controllerSignedMessages!.items[999].signature).toEqual('500')
    })
  })
})
