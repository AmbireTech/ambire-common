import { describe, expect } from '@jest/globals'
import { Storage } from '../../interfaces/storage'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { ActivityController } from './activity'
import {SignedMessage} from "../../interfaces/userRequest";

// @TODO: Reuse BigInt JSON lib, once merged: https://github.com/AmbireTech/ambire-common/pull/286
export function stringify(obj: any): string {
  return JSON.stringify(obj, (key, value) => {
    return typeof value === 'bigint' ? { $bigint: value.toString() } : value
  })
}
export function parse(json: string) {
  return JSON.parse(json, (key, value) => {
    if (value?.$bigint) {
      return BigInt(value.$bigint)
    }

    return value
  })
}

// @TODO: maybe this should be shared with the rest of the tests?
export function produceMemoryStore(): Storage {
  const storage = new Map()
  return {
    get: (key, defaultValue): any => {
      const serialized = storage.get(key)
      return Promise.resolve(serialized ? parse(serialized) : defaultValue)
    },
    set: (key, value) => {
      storage.set(key, stringify(value))
      return Promise.resolve(null)
    }
  }
}

describe('Activity Controller ', () => {
  test('AccountsOps are persisted in the storage', async () => {
    const storage = produceMemoryStore()
    const controller = new ActivityController(storage)

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
    const storageActivity = await controller.getAccountsOps()

    expect(storageActivity['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5:ethereum']).toEqual([
      accountOp
    ])
  })

  test('SignedMessages are persisted in the storage', async () => {
    const storage = produceMemoryStore()
    const controller = new ActivityController(storage)

    const signedMessage: SignedMessage = {
      content: {
        kind: 'message',
        message: '0x74657374'
      },
      fromUserRequestId: 1n,
      signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503'
    }

    await controller.addSignedMessage(signedMessage, '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5')
    const storageActivity = await controller.getSignedMessages()

    expect(storageActivity['0xB674F3fd5F43464dB0448a57529eAF37F04cceA5']).toEqual([
      signedMessage
    ])
  })
})
