import { describe, expect } from '@jest/globals'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { ActivityController } from './activity'
import { SignedMessage } from '../../interfaces/userRequest'
import { produceMemoryStore } from '../../../test/helpers'

describe('Activity Controller ', () => {
  test('AccountsOps - retrieved from Controller and persisted in Storage', async () => {
    const storage = produceMemoryStore()
    const controller = new ActivityController(storage, {
      account: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      network: 'ethereum'
    })

    const accountOp = {
      accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'ethereum',
      nonce: 225,
      signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
      calls: [
        {
          to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
          value: BigInt(0),
          data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
        }
      ]
    } as AccountOp

    await controller.addAccountOp(accountOp)
    const controllerAccountsOps = controller.accountsOps
    const storageAccountsOps = await storage.get('accountsOps', {})

    expect(controllerAccountsOps).toEqual({
      items: [accountOp],
      itemsTotal: 1,
      currentPage: 0,
      maxPages: 1
    })
    expect(storageAccountsOps['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum).toEqual([
      accountOp
    ])
  })

  test('AccountsOps - pagination and filtration handled correctly', async () => {
    const storage = produceMemoryStore()
    const controller = new ActivityController(storage, {
      account: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      network: 'ethereum'
    })

    const accountsOps = [
      {
        accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'ethereum',
        nonce: 225,
        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        calls: [
          {
            to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
            value: BigInt(0),
            data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
          }
        ]
      },
      {
        accountAddr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'ethereum',
        nonce: 225,
        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        calls: [
          {
            to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
            value: BigInt(0),
            data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
          }
        ]
      },
      {
        accountAddr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'optimism',
        nonce: 225,
        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        calls: [
          {
            to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
            value: BigInt(0),
            data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
          }
        ]
      },
      {
        accountAddr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
        signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'optimism',
        nonce: 225,
        signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
        calls: [
          {
            to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
            value: BigInt(0),
            data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
          }
        ]
      }
    ] as AccountOp[]

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
          nonce: 225,
          signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
          calls: [
            {
              to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
              value: BigInt(0),
              data: '0x23b872dd000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000077777777789a8bbee6c64381e5e89e501fb0e4c80000000000000000000000000000000000000000000000000000000000000089'
            }
          ]
        }
      ],
      itemsTotal: 2,
      currentPage: 1, // index based
      maxPages: 2
    })
  })

  test('SignedMessages - retrieved from Controller and persisted in Storage', async () => {
    const storage = produceMemoryStore()
    const controller = new ActivityController(storage, {
      account: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      network: 'ethereum'
    })

    const signedMessage: SignedMessage = {
      content: {
        kind: 'message',
        message: '0x74657374'
      },
      fromUserRequestId: 1n,
      signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503'
    }

    await controller.addSignedMessage(
      signedMessage,
      '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      'ethereum'
    )
    const controllerSignedMessages = controller.signedMessages
    const storageSignedMessages = await storage.get('signedMessages', {})

    expect(controllerSignedMessages).toEqual({
      items: [signedMessage],
      itemsTotal: 1,
      currentPage: 0,
      maxPages: 1
    })
    expect(storageSignedMessages['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'].ethereum).toEqual([
      signedMessage
    ])
  })

  test('SignedMessages - pagination and filtration handled correctly', async () => {
    const storage = produceMemoryStore()
    const controller = new ActivityController(storage, {
      account: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      network: 'ethereum'
    })

    const signedMessage: SignedMessage = {
      content: {
        kind: 'message',
        message: '0x74657374'
      },
      fromUserRequestId: 1n,
      signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503'
    }

    const expectedSignedMessage: SignedMessage = {
      content: {
        kind: 'message',
        message: '0x123456'
      },
      fromUserRequestId: 1n,
      signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503'
    }

    await controller.addSignedMessage(
      signedMessage,
      '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      'ethereum'
    )
    await controller.addSignedMessage(
      signedMessage,
      '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      'ethereum'
    )
    await controller.addSignedMessage(
      signedMessage,
      '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      'optimism'
    )
    await controller.addSignedMessage(
      expectedSignedMessage,
      '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      'optimism'
    )

    // For the following criteria, we have 2 matching SignedMessages, these will be paginated on 2 pages (1 SignedMessage per page)
    await controller.setSignedMessagesPagination({ fromPage: 1, itemsPerPage: 1 })
    await controller.setFilters({
      account: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      network: 'optimism'
    })

    const controllerSignedMessages = controller.signedMessages

    expect(controllerSignedMessages).toEqual({
      items: [expectedSignedMessage],
      itemsTotal: 2,
      currentPage: 1, // index based
      maxPages: 2
    })
  })
})
