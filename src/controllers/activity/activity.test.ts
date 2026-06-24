import { getAddress } from 'ethers'
import fetch from 'node-fetch'

import { describe, expect } from '@jest/globals'

import { makeMainController } from '../../../test/helpers/mainController'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks as predefinedNetworks } from '../../consts/networks'
import { IMainController } from '../../interfaces/main'
import { IStorageController, Storage } from '../../interfaces/storage'
import * as submittedAccountOp from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { ActivityController } from './activity'
import { SignedMessage } from './types'

const INIT_PARAMS = {
  account: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  chainId: 1n
}

const ACCOUNTS = [
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

const SUBMITTED_ACCOUNT_OP = {
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
  gasLimit: null,
  gasFeePayment: {
    isGasTank: false,
    paidBy: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
    inToken: '0x0000000000000000000000000000000000000000',
    amount: 1n,
    simulatedGasLimit: 1n,
    gasPrice: 1n
  },
  chainId: 1n,
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
  status: 'broadcasted-but-not-confirmed',
  identifiedBy: {
    type: 'Transaction',
    identifier: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb'
  }
} as submittedAccountOp.SubmittedAccountOp

const SIGNED_MESSAGE: SignedMessage = {
  fromRequestId: 1,
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
  chainId: 1n
}

let mainCtrl: IMainController
let storageCtrl: IStorageController
let storage: Storage

const buildMockReceipt = (overrides: Partial<any> = {}) =>
  ({
    status: 1,
    blockNumber: 123,
    blockHash: '0xmock-block-hash',
    gasUsed: 21_000n,
    logs: [],
    ...overrides
  }) as any

const prepareTest = async () => {
  const controller = new ActivityController(
    mainCtrl.storage,
    fetch,
    mainCtrl.callRelayer,
    mainCtrl.accounts,
    mainCtrl.selectedAccount,
    mainCtrl.providers,
    mainCtrl.networks,
    mainCtrl.portfolio,
    mainCtrl.safe,
    () => Promise.resolve()
  )

  const sessionId = Date.now().toString()

  await controller.filterAccountsOps(sessionId, INIT_PARAMS)

  return {
    controller,
    storage,
    sessionId
  }
}

const prepareSignedMessagesTest = async () => {
  const controller = new ActivityController(
    mainCtrl.storage,
    fetch,
    mainCtrl.callRelayer,
    mainCtrl.accounts,
    mainCtrl.selectedAccount,
    mainCtrl.providers,
    mainCtrl.networks,
    mainCtrl.portfolio,
    mainCtrl.safe,
    () => Promise.resolve()
  )

  const sessionId = Date.now().toString()

  await controller.filterSignedMessages(sessionId, INIT_PARAMS)

  return { controller, sessionId }
}

describe('Activity Controller ', () => {
  // Setup other controllers only once!
  // Otherwise account states will be fetched in every tests and the RPC may timeout or throw
  // errors
  beforeAll(async () => {
    ;({ mainCtrl, storageCtrl, storage } = await makeMainController(async (s) => {
      await s.set('accounts', ACCOUNTS)
      await s.set(
        'networks',
        Object.fromEntries(
          predefinedNetworks.map((network) => [network.chainId.toString(), network])
        )
      )
    }))
    await mainCtrl.selectedAccount.setAccount(ACCOUNTS[1]!)
  })

  // Clear activity storage after each test
  // but keep accounts, providers etc.
  afterEach(async () => {
    jest.restoreAllMocks()
    await storageCtrl.remove('accountsOps')
    await storageCtrl.remove('signedMessages')
  })

  describe('AccountsOps', () => {
    test('should detect various address poisoning attacks (4/4, 5/5, 6/5, 4/8, 3/8, 0/8 and reject total < 8 or 0/0)', async () => {
      const { controller } = await prepareTest()

      const trustedRecipient = '0xF0cD725D2195b1D3f4BD038c3786005B793237DB'
      const poisoningRecipient4 = '0xF0cdAaAaaAAAaAAAaaaAaAaAAaAaaaAaAaaA37Db'
      const poisoningRecipient5 = '0xf0cd7BbbBbbbBbBBbbbBBBBbbbbBBbbbbbb237DB'
      const poisoningRecipient6 = '0xf0cd72ccCCccCcCccCCCCcCCcCcCCCCccCC237DB'
      const poisoningRecipient4to8 = '0xF0CdDDDddddDdDdDdDDDDDDDDdddDDDD793237db'
      const poisoningRecipient3to8 = '0xF0cEEeeeEEEEEeEEEEeeEEEEeeEeeeEe793237db'
      const poisoningRecipient0to8 = '0xaB12ffFFfFFFFfFfFFFffffFffFFFfFF793237DB'
      const poisoningRecipient3to4 = '0xF0cAAaAaAaaaAAaAAaaaaAAaaaAaAAAaAAaa37dB'
      const poisoningRecipient0to0 = '0xAB12eeeeeeeEeeeEeeeEEeeeEEEEEeeEeEeeCdef'

      await controller.addAccountOp({
        ...SUBMITTED_ACCOUNT_OP,
        nonce: 226n,
        txnId: '0x1111111111111111111111111111111111111111111111111111111111111111',
        timestamp: 1_700_000_100_000,
        calls: [{ to: trustedRecipient, value: 0n, data: '0x' }]
      })

      const trustedRecipientResult = await controller.hasAccountOpsSentTo(
        trustedRecipient,
        ACCOUNTS[1]!.addr
      )

      expect(trustedRecipientResult).toEqual({
        found: true,
        lastTransactionDate: new Date(1_700_000_100_000),
        addressPoisoningMatch: null
      })

      const poisoningResult4 = await controller.hasAccountOpsSentTo(
        poisoningRecipient4,
        ACCOUNTS[1]!.addr
      )
      const poisoningResult5 = await controller.hasAccountOpsSentTo(
        poisoningRecipient5,
        ACCOUNTS[1]!.addr
      )
      const poisoningResult6 = await controller.hasAccountOpsSentTo(
        poisoningRecipient6,
        ACCOUNTS[1]!.addr
      )
      const poisoningResult4to8 = await controller.hasAccountOpsSentTo(
        poisoningRecipient4to8,
        ACCOUNTS[1]!.addr
      )
      const poisoningResult3to8 = await controller.hasAccountOpsSentTo(
        poisoningRecipient3to8,
        ACCOUNTS[1]!.addr
      )
      const poisoningResult0to8 = await controller.hasAccountOpsSentTo(
        poisoningRecipient0to8,
        ACCOUNTS[1]!.addr
      )
      const poisoningResult3to4 = await controller.hasAccountOpsSentTo(
        poisoningRecipient3to4,
        ACCOUNTS[1]!.addr
      )
      const poisoningResult0to0 = await controller.hasAccountOpsSentTo(
        poisoningRecipient0to0,
        ACCOUNTS[1]!.addr
      )

      expect(poisoningResult4).toEqual({
        found: false,
        lastTransactionDate: null,
        addressPoisoningMatch: {
          matchedAddress: trustedRecipient,
          matchedPrefixCharsCount: 4,
          matchedSuffixCharsCount: 4
        }
      })

      expect(poisoningResult5).toEqual({
        found: false,
        lastTransactionDate: null,
        addressPoisoningMatch: {
          matchedAddress: trustedRecipient,
          matchedPrefixCharsCount: 5,
          matchedSuffixCharsCount: 5
        }
      })

      expect(poisoningResult6).toEqual({
        found: false,
        lastTransactionDate: null,
        addressPoisoningMatch: {
          matchedAddress: trustedRecipient,
          matchedPrefixCharsCount: 6,
          matchedSuffixCharsCount: 5
        }
      })

      expect(poisoningResult4to8).toEqual({
        found: false,
        lastTransactionDate: null,
        addressPoisoningMatch: {
          matchedAddress: trustedRecipient,
          matchedPrefixCharsCount: 4,
          matchedSuffixCharsCount: 8
        }
      })

      expect(poisoningResult3to8).toEqual({
        found: false,
        lastTransactionDate: null,
        addressPoisoningMatch: {
          matchedAddress: trustedRecipient,
          matchedPrefixCharsCount: 3,
          matchedSuffixCharsCount: 8
        }
      })

      expect(poisoningResult0to8).toEqual({
        found: false,
        lastTransactionDate: null,
        addressPoisoningMatch: {
          matchedAddress: trustedRecipient,
          matchedPrefixCharsCount: 0,
          matchedSuffixCharsCount: 8
        }
      })

      expect(poisoningResult3to4).toEqual({
        found: false,
        lastTransactionDate: null,
        addressPoisoningMatch: null
      })

      expect(poisoningResult0to0).toEqual({
        found: false,
        lastTransactionDate: null,
        addressPoisoningMatch: null
      })
    })

    test('should not detect poisoning without transaction history', async () => {
      const { controller } = await prepareTest()

      const poisoningRecipient4to4 = '0xF0cdAaAaaAAAaAAAaaaAaAaAAaAaaaAaAaaA37Db'
      const normalizedPoisoningRecipient4to4 = poisoningRecipient4to4.toLowerCase()

      const firstTimeSendResult = await controller.hasAccountOpsSentTo(
        poisoningRecipient4to4,
        ACCOUNTS[1]!.addr
      )

      expect(firstTimeSendResult).toEqual({
        found: false,
        lastTransactionDate: null,
        addressPoisoningMatch: null
      })

      await controller.addAccountOp({
        ...SUBMITTED_ACCOUNT_OP,
        nonce: 227n,
        txnId: '0x2222222222222222222222222222222222222222222222222222222222222222',
        timestamp: 1_700_000_200_000,
        calls: [{ to: normalizedPoisoningRecipient4to4, value: 0n, data: '0x' }]
      })

      const nonFirstTimeSendResult = await controller.hasAccountOpsSentTo(
        normalizedPoisoningRecipient4to4,
        ACCOUNTS[1]!.addr
      )

      expect(nonFirstTimeSendResult).toEqual({
        found: true,
        lastTransactionDate: new Date(1_700_000_200_000),
        addressPoisoningMatch: null
      })
    })

    test('Retrieved from Controller and persisted in Storage', async () => {
      const { controller, sessionId } = await prepareTest()

      await controller.addAccountOp(SUBMITTED_ACCOUNT_OP)
      const controllerAccountsOps = controller.accountsOps
      const storageAccountsOps = await storage.get('accountsOps', {})

      expect(controllerAccountsOps[sessionId]!.result).toEqual({
        items: [{ ...SUBMITTED_ACCOUNT_OP, status: 'broadcasted-but-not-confirmed' }], // everytime we add a new AccountOp, it gets broadcasted-but-not-confirmed status
        itemsTotal: 1,
        currentPage: 0,
        maxPages: 1
      })
      expect(storageAccountsOps['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']!['1']).toEqual([
        { ...SUBMITTED_ACCOUNT_OP, status: 'broadcasted-but-not-confirmed' }
      ])
    })

    test('setAccountOpBalanceChanges stores an empty array after 3 failures', async () => {
      const { controller, sessionId } = await prepareTest()

      await controller.addAccountOp(SUBMITTED_ACCOUNT_OP)

      await controller.setAccountOpBalanceChanges(
        SUBMITTED_ACCOUNT_OP.identifiedBy,
        SUBMITTED_ACCOUNT_OP.accountAddr,
        SUBMITTED_ACCOUNT_OP.chainId,
        new Error('balance changes failed')
      )
      expect(controller.accountsOps[sessionId]!.result.items[0]!.balanceChanges).toBeUndefined()
      expect(
        controller.accountsOps[sessionId]!.result.items[0]!.balanceChangesFetchRetryCount
      ).toBe(1)
      expect(controller.accountsOps[sessionId]!.result.items[0]!.balanceChanges).toBe(undefined)

      await controller.setAccountOpBalanceChanges(
        SUBMITTED_ACCOUNT_OP.identifiedBy,
        SUBMITTED_ACCOUNT_OP.accountAddr,
        SUBMITTED_ACCOUNT_OP.chainId,
        new Error('balance changes failed')
      )
      expect(controller.accountsOps[sessionId]!.result.items[0]!.balanceChanges).toBeUndefined()
      expect(
        controller.accountsOps[sessionId]!.result.items[0]!.balanceChangesFetchRetryCount
      ).toBe(2)
      expect(controller.accountsOps[sessionId]!.result.items[0]!.balanceChanges).toBe(undefined)

      await controller.setAccountOpBalanceChanges(
        SUBMITTED_ACCOUNT_OP.identifiedBy,
        SUBMITTED_ACCOUNT_OP.accountAddr,
        SUBMITTED_ACCOUNT_OP.chainId,
        new Error('balance changes failed')
      )
      expect(controller.accountsOps[sessionId]!.result.items[0]!.balanceChanges).toEqual([])
      expect(
        controller.accountsOps[sessionId]!.result.items[0]!.balanceChangesFetchRetryCount
      ).toBe(3)
      const balanceChanges = controller.accountsOps[sessionId]!.result.items[0]!.balanceChanges
      expect(balanceChanges).not.toBe(undefined)
      expect(balanceChanges?.length).toBe(0)
    })

    test('Pagination and filtration handled correctly', async () => {
      const { controller, sessionId } = await prepareTest()

      const accountsOps = [
        {
          accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
          signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
          gasLimit: null,
          gasFeePayment: {
            isGasTank: false,
            paidBy: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
            inToken: '0x0000000000000000000000000000000000000000',
            amount: 1n,
            simulatedGasLimit: 1n,
            gasPrice: 1n
          },
          chainId: 1n,
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
          status: 'broadcasted-but-not-confirmed',
          identifiedBy: {
            type: 'Transaction',
            identifier: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb'
          }
        },
        {
          accountAddr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
          signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
          gasLimit: null,
          gasFeePayment: {
            isGasTank: false,
            paidBy: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
            inToken: '0x0000000000000000000000000000000000000000',
            amount: 1n,
            simulatedGasLimit: 1n,
            gasPrice: 1n
          },
          chainId: 1n,
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
          status: 'broadcasted-but-not-confirmed',
          identifiedBy: {
            type: 'Transaction',
            identifier: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb'
          }
        },
        {
          accountAddr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
          signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
          gasLimit: null,
          gasFeePayment: {
            isGasTank: false,
            paidBy: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
            inToken: '0x0000000000000000000000000000000000000000',
            amount: 1n,
            simulatedGasLimit: 1n,
            gasPrice: 1n
          },
          chainId: 10n,
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
          status: 'broadcasted-but-not-confirmed',
          identifiedBy: {
            type: 'Transaction',
            identifier: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb'
          }
        },
        {
          accountAddr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
          signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
          gasLimit: null,
          gasFeePayment: {
            isGasTank: false,
            paidBy: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
            inToken: '0x0000000000000000000000000000000000000000',
            amount: 1n,
            simulatedGasLimit: 1n,
            gasPrice: 1n
          },
          chainId: 10n,
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
          status: 'broadcasted-but-not-confirmed',
          identifiedBy: {
            type: 'Transaction',
            identifier: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb'
          }
        }
      ] as submittedAccountOp.SubmittedAccountOp[]

      for (const accountOp of accountsOps) {
        await controller.addAccountOp(accountOp)
      }

      // For the following criteria, we have 2 matching AccountsOps, these will be paginated on 2 pages (1 AccountOp per page)
      await controller.filterAccountsOps(
        sessionId,
        {
          account: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
          chainId: 10n
        },
        { fromPage: 1, itemsPerPage: 1 }
      )

      const controllerAccountsOps = controller.accountsOps

      expect(controllerAccountsOps[sessionId]!.result).toEqual({
        items: [
          {
            accountAddr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
            signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
            gasLimit: null,
            gasFeePayment: {
              isGasTank: false,
              paidBy: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
              inToken: '0x0000000000000000000000000000000000000000',
              amount: 1n,
              simulatedGasLimit: 1n,
              gasPrice: 1n
            },
            chainId: 10n,
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
            txnId: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb',
            identifiedBy: {
              type: 'Transaction',
              identifier: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb'
            }
          }
        ],
        itemsTotal: 2,
        currentPage: 1, // index based
        maxPages: 2
      })
    })

    test('`success` status is set correctly', async () => {
      const { controller, sessionId } = await prepareTest()
      const provider = mainCtrl.providers.providers['1']!
      jest
        .spyOn(provider, 'getTransactionReceipt')
        .mockImplementation(async () => buildMockReceipt({ status: 1 }))
      jest.spyOn(mainCtrl.portfolio, 'getTokenBalancesOnBlock').mockResolvedValue([])

      const accountOp = {
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: {
          isGasTank: false,
          paidBy: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
          inToken: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          simulatedGasLimit: 1n,
          gasPrice: 1n
        },
        chainId: 1n,
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
        status: 'broadcasted-but-not-confirmed',
        identifiedBy: {
          type: 'Transaction',
          identifier: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb'
        }
      } as submittedAccountOp.SubmittedAccountOp

      await controller.addAccountOp(accountOp)
      await controller.updateAccountsOpsStatuses()
      if (
        typeof controller.accountsOps[sessionId]!.result.items[0]!.balanceChanges === 'undefined'
      ) {
        await new Promise<void>((resolve) => {
          const unsubscribe = controller.onUpdate(() => {
            const updatedOp = controller.accountsOps[sessionId]!.result.items[0]

            if (typeof updatedOp?.balanceChanges === 'undefined') return

            unsubscribe()
            resolve()
          })
        })
      }
      expect(controller.accountsOps[sessionId]!.result.itemsTotal).toBe(1)
      expect(controller.accountsOps[sessionId]!.result.currentPage).toBe(0)
      expect(controller.accountsOps[sessionId]!.result.maxPages).toBe(1)
      expect(controller.accountsOps[sessionId]!.result.items[0]).toEqual(
        expect.objectContaining({
          ...accountOp,
          status: 'success',
          blockNumber: controller.accountsOps[sessionId]!.result.items[0]!.blockNumber,
          blockHash: controller.accountsOps[sessionId]!.result.items[0]!.blockHash,
          gasUsed: controller.accountsOps[sessionId]!.result.items[0]!.gasUsed
        })
      )
    })

    test('`failed` status is set correctly', async () => {
      const { controller, sessionId } = await prepareTest()
      const provider = mainCtrl.providers.providers['1']!
      jest
        .spyOn(provider, 'getTransactionReceipt')
        .mockImplementation(async () => buildMockReceipt({ status: 0 }))

      const accountOp = {
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: {
          isGasTank: false,
          paidBy: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
          inToken: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          simulatedGasLimit: 1n,
          gasPrice: 1n
        },
        chainId: 1n,
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
        status: 'broadcasted-but-not-confirmed',
        identifiedBy: {
          type: 'Transaction',
          identifier: '0x67ec3acc5274a88c50d1e79e9b9d4c2c3d5e0e3ba3cc33b32d65f3fdb3b5a258'
        }
      } as submittedAccountOp.SubmittedAccountOp

      await controller.addAccountOp(accountOp)
      await controller.updateAccountsOpsStatuses()
      const controllerAccountsOps = controller.accountsOps

      expect(controllerAccountsOps[sessionId]!.result.itemsTotal).toBe(1)
      expect(controllerAccountsOps[sessionId]!.result.currentPage).toBe(0)
      expect(controllerAccountsOps[sessionId]!.result.maxPages).toBe(1)
      expect(controllerAccountsOps[sessionId]!.result.items[0]).toEqual(
        expect.objectContaining({
          ...accountOp,
          status: 'failure',
          blockNumber: controller.accountsOps[sessionId]!.result.items[0]!.blockNumber,
          blockHash: controller.accountsOps[sessionId]!.result.items[0]!.blockHash,
          gasUsed: controller.accountsOps[sessionId]!.result.items[0]!.gasUsed
        })
      )
    })

    test('should display pending txns banners', async () => {
      const { controller } = await prepareTest()

      const accountOp = {
        ...SUBMITTED_ACCOUNT_OP,
        status: AccountOpStatus.BroadcastedButNotConfirmed,
        timestamp: Date.now()
      }

      await controller.addAccountOp(accountOp)

      expect(controller.banners.length).toBe(1)
      expect(controller.banners[0]!.category).toBe('pending-to-be-confirmed-acc-ops')
      expect(controller.banners[0]!.meta!.accountOpsCount).toBe(1)
      await controller.addAccountOp({ ...accountOp, timestamp: Date.now() })
      expect(controller.banners.length).toBe(1)
      expect(controller.banners[0]!.category).toBe('pending-to-be-confirmed-acc-ops')
      expect(controller.banners[0]!.meta!.accountOpsCount).toBe(2)
    })
    test('should display failed txns banners and hide them on session removal', async () => {
      const { controller } = await prepareTest()
      const provider = mainCtrl.providers.providers['1']!
      jest
        .spyOn(provider, 'getTransactionReceipt')
        .mockImplementation(async () => buildMockReceipt({ status: 0 }))

      const accountOp = {
        ...SUBMITTED_ACCOUNT_OP,
        status: AccountOpStatus.BroadcastedButNotConfirmed,
        timestamp: Date.now()
      }

      await controller.addAccountOp(accountOp)

      expect(controller.banners.length).toBe(1)
      expect(controller.banners[0]!.category).toBe('pending-to-be-confirmed-acc-ops')
      const spy = jest.spyOn(submittedAccountOp, 'updateOpStatus')
      spy.mockImplementationOnce((op) => {
        op.status = AccountOpStatus.Rejected
        return op
      })

      await controller.updateAccountsOpsStatuses()
      expect(controller.banners.length).toBe(1)
      expect(controller.banners[0]!.category).toBe('failed-acc-ops')
      expect(controller.banners[0]!.meta!.seen).toBe(false)
      await controller.filterAccountsOps('dashboard-test-id', {
        account: accountOp.accountAddr
      })
      expect(controller.banners[0]!.meta!.seen).toBe(true)
      controller.resetAccountsOpsFilters('dashboard-test-id')
      expect(controller.banners.length).toBe(0)
    })

    // test('`Unknown but past nonce` status is set correctly', async () => {
    //   await selectedAccountCtrl.setAccount(ACCOUNTS[0])
    //   await accountsCtrl.updateAccountState('0xa07D75aacEFd11b425AF7181958F0F85c312f143')
    //   const controller = new ActivityController(
    //     storageCtrl,
    //     fetch,
    //     callRelayer,
    //     accountsCtrl,
    //     selectedAccountCtrl,
    //     providersCtrl,
    //     networksCtrl,
    //     portfolioCtrl,
    //     () => Promise.resolve()
    //   )

    //   const sessionId = Date.now().toString()

    //   await controller.filterAccountsOps(sessionId, {
    //     account: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
    //     chainId: 1n
    //   })

    //   const accountOp = {
    //     accountAddr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
    //     signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
    //     gasLimit: null,
    //     gasFeePayment: {
    //       isGasTank: false,
    //       paidBy: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
    //       inToken: '0x0000000000000000000000000000000000000000',
    //       amount: 1n,
    //       simulatedGasLimit: 1n,
    //       gasPrice: 1n
    //     },
    //     chainId: 1n,
    //     nonce: 225n,
    //     signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
    //     calls: [
    //       {
    //         to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
    //         value: BigInt(0),
    //         data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
    //       }
    //     ],
    //     // wrong txn id, so we can simulate nullish getTransactionReceipt()
    //     txnId: '0x0000000000000000000000000000000000000000000000000000000000000001',
    //     status: 'broadcasted-but-not-confirmed',
    //     identifiedBy: {
    //       type: 'Transaction',
    //       identifier: '0x0000000000000000000000000000000000000000000000000000000000000001'
    //     }
    //   } as SubmittedAccountOp
    //   const accountOpCompleted = {
    //     accountAddr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
    //     signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
    //     gasLimit: null,
    //     gasFeePayment: {
    //       isGasTank: false,
    //       paidBy: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
    //       inToken: '0x0000000000000000000000000000000000000000',
    //       amount: 1n,
    //       simulatedGasLimit: 1n,
    //       gasPrice: 1n
    //     },
    //     chainId: 1n,
    //     nonce: 225n,
    //     signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
    //     calls: [
    //       {
    //         to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
    //         value: BigInt(0),
    //         data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
    //       }
    //     ],
    //     // wrong txn id, so we can simulate nullish getTransactionReceipt()
    //     txnId: '0x0000000000000000000000000000000000000000000000000000000000000001',
    //     status: 'success',
    //     identifiedBy: {
    //       type: 'Transaction',
    //       identifier: '0x0000000000000000000000000000000000000000000000000000000000000001'
    //     }
    //   } as SubmittedAccountOp

    //   await controller.addAccountOp(accountOp)
    //   await controller.addAccountOp(accountOpCompleted)
    //   await controller.updateAccountsOpsStatuses()
    //   const controllerAccountsOps = controller.accountsOps

    //   expect(controllerAccountsOps[sessionId]!.result).toEqual({
    //     items: [accountOpCompleted, { ...accountOp, status: 'unknown-but-past-nonce' }], // we expect unknown-but-past-nonce status here
    //     itemsTotal: 2,
    //     currentPage: 0,
    //     maxPages: 1
    //   })
    // })

    test('Filtered account ops include account ops only on enabled networks', async () => {
      const { controller, sessionId } = await prepareTest()

      const accountsOps = Array.from(Array(20).keys()).map((index) => {
        let chainId = 1n

        if (index >= 15) {
          chainId = 56n
        } else if (index > 8) {
          chainId = 10n
        }

        return {
          ...SUBMITTED_ACCOUNT_OP,
          chainId,
          timestamp: Date.now() + Math.random() * 100,
          nonce: BigInt(index)
        }
      })

      for (const ao of accountsOps) {
        await controller.addAccountOp(ao)
      }

      await controller.filterAccountsOps(
        sessionId,
        {
          account: SUBMITTED_ACCOUNT_OP.accountAddr
        },
        {
          fromPage: 0,
          itemsPerPage: 20
        }
      )

      const controllerAccountsOps1 = controller.accountsOps[sessionId]?.result.items

      expect(controllerAccountsOps1!.filter(({ chainId }) => chainId === 56n).length).toBe(5)

      await mainCtrl.networks.updateNetwork({ disabled: true }, 56n)

      await controller.filterAccountsOps(sessionId, INIT_PARAMS, {
        fromPage: 0,
        itemsPerPage: 20
      })

      const controllerAccountsOps2 = controller.accountsOps

      expect(
        controllerAccountsOps2[sessionId]?.result.items.filter(({ chainId }) => chainId === 56n)
          .length
      ).toBe(0)

      await mainCtrl.networks.updateNetwork({ disabled: false }, 56n)
    })

    test('Keeps no more than 1000 items', async () => {
      const { controller, sessionId } = await prepareTest()

      const accountOp = {
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: {
          isGasTank: false,
          paidBy: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
          inToken: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          simulatedGasLimit: 1n,
          gasPrice: 1n
        },
        chainId: 1n,
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
        status: 'broadcasted-but-not-confirmed',
        identifiedBy: {
          type: 'Transaction',
          identifier: '0x891e12877c24a8292fd73fd741897682f38a7bcd497374a6b68e8add89e1c0fb'
        }
      } as submittedAccountOp.SubmittedAccountOp

      const accountsOps = Array.from(Array(1500).keys()).map((key) => ({
        ...accountOp,
        nonce: BigInt(key)
      }))

      for (const ao of accountsOps) {
        await controller.addAccountOp(ao)
      }

      await controller.filterAccountsOps(sessionId, INIT_PARAMS, {
        fromPage: 0,
        itemsPerPage: 1000
      })
      const controllerAccountsOps = controller.accountsOps
      expect(controllerAccountsOps[sessionId]!.result!.itemsTotal).toEqual(1000)
      // newest added item will be added to the beginning of the array
      // in this case newest item is with nonce 1499n and should be at index 0
      expect(controllerAccountsOps[sessionId]!.result!.items[0]!.nonce).toEqual(1499n)
      expect(controllerAccountsOps[sessionId]!.result!.items[999]!.nonce).toEqual(500n)
    })
  })

  describe('SignedMessages', () => {
    test('Retrieved from Controller and persisted in Storage', async () => {
      const { controller, sessionId } = await prepareSignedMessagesTest()

      const signedMessage: SignedMessage = {
        fromRequestId: 1,
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
        chainId: 1n
      }

      await controller.addSignedMessage(signedMessage, '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5')
      const controllerSignedMessages = controller.signedMessages
      const storageSignedMessages = await storage.get('signedMessages', {})

      expect(controllerSignedMessages[sessionId]!.result).toEqual({
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
      const { controller, sessionId } = await prepareSignedMessagesTest()

      await controller.addSignedMessage(
        SIGNED_MESSAGE,
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      )
      await controller.addSignedMessage(
        SIGNED_MESSAGE,
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      )
      await controller.addSignedMessage(
        SIGNED_MESSAGE,
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
      )

      // For the following criteria, we have 2 matching SignedMessages, these will be paginated on 2 pages (1 Message per page)
      await controller.filterSignedMessages(
        sessionId,
        {
          account: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
          chainId: 10n
        },
        { fromPage: 1, itemsPerPage: 1 }
      )

      const controllerSignedMessages = controller.signedMessages

      expect(controllerSignedMessages[sessionId]!.result).toEqual({
        items: [SIGNED_MESSAGE],
        itemsTotal: 3,
        currentPage: 1, // index based
        maxPages: 3
      })
    })

    test('Keeps no more than 1000 items', async () => {
      const { controller, sessionId } = await prepareSignedMessagesTest()

      const signedMessages = Array.from(Array(1500).keys()).map((key) => ({
        ...SIGNED_MESSAGE,
        signature: key.toString()
      }))

      for (const sm of signedMessages) {
        await controller.addSignedMessage(sm, '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5')
      }

      await controller.filterSignedMessages(sessionId, INIT_PARAMS, {
        fromPage: 0,
        itemsPerPage: 1000
      })
      const controllerSignedMessages = controller.signedMessages

      expect(controllerSignedMessages[sessionId]!.result!.itemsTotal).toEqual(1000)
      // newest added item will be added to the beginning of the array
      // in this case newest item is with signature 1499 and should be at index 0
      expect(controllerSignedMessages[sessionId]!.result!.items[0]!.signature).toEqual('1499')
      expect(controllerSignedMessages[sessionId]!.result!.items[999]!.signature).toEqual('500')
    })
  })
  test('removeAccountData', async () => {
    const controller = new ActivityController(
      mainCtrl.storage,
      fetch,
      mainCtrl.callRelayer,
      mainCtrl.accounts,
      mainCtrl.selectedAccount,
      mainCtrl.providers,
      mainCtrl.networks,
      mainCtrl.portfolio,
      mainCtrl.safe,
      () => Promise.resolve()
    )

    const sessionId = Date.now().toString()

    // Apply filtration
    await controller.filterAccountsOps(sessionId, INIT_PARAMS)
    await controller.filterSignedMessages(sessionId, INIT_PARAMS)

    // Add an accountOp
    await controller.addAccountOp(SUBMITTED_ACCOUNT_OP)
    // Add a signedMessage
    await controller.addSignedMessage(SIGNED_MESSAGE, INIT_PARAMS.account)

    // Validate that they are in the controller
    expect(controller.accountsOps[sessionId]!.result!.items.length).toEqual(1)
    expect(controller.signedMessages[sessionId]!.result!.items.length).toEqual(1)

    // Remove account data
    await controller.removeAccountData('0xB674F3fd5F43464dB0448a57529eAF37F04cceA5')

    // Validate that the account data is removed
    expect(controller.accountsOps[sessionId]!.result!.items.length).toEqual(0)
    expect(controller.signedMessages[sessionId]!.result!.items.length).toEqual(0)
  })

  describe('Sent-to history', () => {
    const DOMAIN_ADDR_A = '0xF0cD725D2195b1D3f4BD038c3786005B793237DB'
    const DOMAIN_ADDR_B = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

    const SENT_AT = new Date('2024-03-01T10:00:00Z').getTime()
    const SENT_AT_LATER = new Date('2024-06-15T18:30:00Z').getTime()

    it('records and reads the address a domain was sent to (global, case-insensitive)', async () => {
      const { controller } = await prepareTest()

      // await controller.recordSentToDomain('alice.eth', DOMAIN_ADDR_A, SENT_AT)
      await controller.addAccountOp({
        ...SUBMITTED_ACCOUNT_OP,
        calls: [{ to: DOMAIN_ADDR_A, recipientDomain: 'alice.eth', value: 0n, data: '0x' }]
      })

      // Checksummed, and the domain lookup is case-insensitive.
      expect(controller.getSentToDomainAddress('alice.eth')).toBe(getAddress(DOMAIN_ADDR_A))
      expect(controller.getSentToDomainAddress('ALICE.eth')).toBe(getAddress(DOMAIN_ADDR_A))
    })

    it('overwrites with the most recent address', async () => {
      const { controller } = await prepareTest()

      await controller.addAccountOp({
        ...SUBMITTED_ACCOUNT_OP,
        timestamp: SENT_AT,
        calls: [{ to: DOMAIN_ADDR_B, recipientDomain: 'alice.eth', value: 0n, data: '0x' }]
      })
      await controller.addAccountOp({
        ...SUBMITTED_ACCOUNT_OP,
        timestamp: SENT_AT_LATER,
        calls: [{ to: DOMAIN_ADDR_A, recipientDomain: 'alice.eth', value: 0n, data: '0x' }]
      })

      expect(controller.getSentToDomainAddress('alice.eth')).toBe(getAddress(DOMAIN_ADDR_A))
    })

    it('stores recipients checksummed', async () => {
      const { controller } = await prepareTest()

      const recipientLower = '0xf0cd725d2195b1d3f4bd038c3786005b793237db'
      await controller.addAccountOp({
        ...SUBMITTED_ACCOUNT_OP,
        nonce: 302n,
        txnId: '0x4c8a1d6f93b072e5af18c34d9e6072b1f5a83c0d7e29b46f1a0c5d8e3b97f246',
        timestamp: SENT_AT_LATER,
        calls: [{ to: recipientLower, value: 0n, data: '0x' }]
      })

      const stored = await storage.get('sentToHistory', { domains: {}, recipients: {} })
      const recipientsForAccount = stored.recipients[SUBMITTED_ACCOUNT_OP.accountAddr]
      expect(recipientsForAccount).toBeDefined()

      expect(recipientsForAccount![getAddress(recipientLower)]).toBe(SENT_AT_LATER)
      expect(recipientsForAccount![recipientLower]).toBeUndefined()
    })
  })
})
