import fetch from 'node-fetch'

import { describe, expect } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { RPCProviders } from '../../interfaces/provider'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { ActivityController, SignedMessage, SubmittedAccountOp } from './activity'

const INIT_PARAMS = {
  account: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  network: 'ethereum'
}

const providers: RPCProviders = {}

networks.forEach((network) => {
  providers[network.id] = getRpcProvider(network.rpcUrls, network.chainId)
  providers[network.id].isWorking = true
})

describe('Activity Controller ', () => {
  const accounts = [
    {
      addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
      associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
      initialPrivileges: [],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
      },
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: '0xa07D75aacEFd11b425AF7181958F0F85c312f143'
      }
    },
    {
      addr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      initialPrivileges: [],
      associatedKeys: ['0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
      },
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      }
    }
  ]

  describe('AccountsOps', () => {
    test('Retrieved from Controller and persisted in Storage', async () => {
      const storage = produceMemoryStore()
      await storage.set('accounts', accounts)
      let providersCtrl: ProvidersController
      const networksCtrl = new NetworksController(
        storage,
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
      const accountsCtrl = new AccountsController(storage, providersCtrl, networksCtrl, () => {})
      await accountsCtrl.initialLoadPromise
      accountsCtrl.selectedAccount = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      const controller = new ActivityController(
        storage,
        fetch,
        accountsCtrl,
        providersCtrl,
        networksCtrl,
        () => Promise.resolve()
      )
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
      await storage.set('accounts', accounts)
      let providersCtrl: ProvidersController
      const networksCtrl = new NetworksController(
        storage,
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
      const accountsCtrl = new AccountsController(storage, providersCtrl, networksCtrl, () => {})
      await accountsCtrl.initialLoadPromise
      accountsCtrl.selectedAccount = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      const controller = new ActivityController(
        storage,
        fetch,
        accountsCtrl,
        providersCtrl,
        networksCtrl,
        () => Promise.resolve()
      )

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
      await storage.set('accounts', accounts)
      let providersCtrl: ProvidersController
      const networksCtrl = new NetworksController(
        storage,
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
      const accountsCtrl = new AccountsController(storage, providersCtrl, networksCtrl, () => {})
      await accountsCtrl.initialLoadPromise
      accountsCtrl.selectedAccount = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      const controller = new ActivityController(
        storage,
        fetch,
        accountsCtrl,
        providersCtrl,
        networksCtrl,
        () => Promise.resolve()
      )

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
      expect(controller.accountsOps).toEqual({
        items: [{ ...accountOp, status: 'success' }], //  we expect success here
        itemsTotal: 1,
        currentPage: 0,
        maxPages: 1
      })
    })

    test('`failed` status is set correctly', async () => {
      const storage = produceMemoryStore()
      await storage.set('accounts', accounts)
      let providersCtrl: ProvidersController
      const networksCtrl = new NetworksController(
        storage,
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
      const accountsCtrl = new AccountsController(storage, providersCtrl, networksCtrl, () => {})
      await accountsCtrl.initialLoadPromise
      accountsCtrl.selectedAccount = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      const controller = new ActivityController(
        storage,
        fetch,
        accountsCtrl,
        providersCtrl,
        networksCtrl,
        () => Promise.resolve()
      )

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
      await storage.set('accounts', accounts)
      let providersCtrl: ProvidersController
      const networksCtrl = new NetworksController(
        storage,
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
      const accountsCtrl = new AccountsController(storage, providersCtrl, networksCtrl, () => {})
      await accountsCtrl.initialLoadPromise
      accountsCtrl.selectedAccount = '0xa07D75aacEFd11b425AF7181958F0F85c312f143'
      const controller = new ActivityController(
        storage,
        fetch,
        accountsCtrl,
        providersCtrl,
        networksCtrl,
        () => Promise.resolve()
      )

      controller.init({
        account: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
        network: 'ethereum'
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
      await storage.set('accounts', accounts)
      let providersCtrl: ProvidersController
      const networksCtrl = new NetworksController(
        storage,
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
      const accountsCtrl = new AccountsController(storage, providersCtrl, networksCtrl, () => {})
      await accountsCtrl.initialLoadPromise
      accountsCtrl.selectedAccount = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      const controller = new ActivityController(
        storage,
        fetch,
        accountsCtrl,
        providersCtrl,
        networksCtrl,
        () => Promise.resolve()
      )

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
      await storage.set('accounts', accounts)
      let providersCtrl: ProvidersController
      const networksCtrl = new NetworksController(
        storage,
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
      const accountsCtrl = new AccountsController(storage, providersCtrl, networksCtrl, () => {})
      await accountsCtrl.initialLoadPromise
      accountsCtrl.selectedAccount = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      const controller = new ActivityController(
        storage,
        fetch,
        accountsCtrl,
        providersCtrl,
        networksCtrl,
        () => Promise.resolve()
      )

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
      await storage.set('accounts', accounts)
      let providersCtrl: ProvidersController
      const networksCtrl = new NetworksController(
        storage,
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
      const accountsCtrl = new AccountsController(storage, providersCtrl, networksCtrl, () => {})
      await accountsCtrl.initialLoadPromise
      accountsCtrl.selectedAccount = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      const controller = new ActivityController(
        storage,
        fetch,
        accountsCtrl,
        providersCtrl,
        networksCtrl,
        () => Promise.resolve()
      )

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
      await storage.set('accounts', accounts)
      let providersCtrl: ProvidersController
      const networksCtrl = new NetworksController(
        storage,
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
      const accountsCtrl = new AccountsController(storage, providersCtrl, networksCtrl, () => {})
      await accountsCtrl.initialLoadPromise
      accountsCtrl.selectedAccount = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      const controller = new ActivityController(
        storage,
        fetch,
        accountsCtrl,
        providersCtrl,
        networksCtrl,
        () => Promise.resolve()
      )

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
