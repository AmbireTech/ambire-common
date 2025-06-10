import { expect } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { Call } from '../../../accountOp/types'
import { HumanizerMeta, HumanizerVisualization, IrCall } from '../../interfaces'
import { privilegeHumanizer } from './privileges'

const transactions: { [key: string]: Call[] } = {
  privileges: [
    {
      to: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      value: 0n,
      data: '0x0d5828d40000000000000000000000005ff137d4b0fdcd49dca30c7cf57e578a026d27890000000000000000000000000000000000000000000000000000000000007171'
    },
    {
      to: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      value: 0n,
      data: '0x0d5828d40000000000000000000000006969174FD72466430a46e18234D0b530c9FD5f490000000000000000000000000000000000000000000000000000000000000001'
    },
    {
      to: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      value: 0n,
      data: '0x0d5828d40000000000000000000000006969174FD72466430a46e18234D0b530c9FD5f490000000000000000000000000000000000000000000000000000000000000000'
    }
  ]
}

describe('privileges', () => {
  const accountOp: AccountOp = {
    accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
    chainId: 1n,
    // chainId: 137n,
    // this may not be defined, in case the user has not picked a key yet
    signingKeyAddr: null,
    signingKeyType: null,
    // this may not be set in case we haven't set it yet
    nonce: null,
    calls: [],
    gasLimit: null,
    signature: null,
    gasFeePayment: null,
    // This is used when we have an account recovery to finalize before executing the AccountOp,
    // And we set this to the recovery finalization AccountOp; could be used in other scenarios too in the future,
    // for example account migration (from v1 QuickAcc to v2)
    accountOpToExecuteBefore: null
    // This is fed into the humanizer to help visualize the accountOp
    // This can contain info like the value of specific share tokens at the time of signing,
    // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
    // "remembered" at the time of signing in order to visualize history properly
    // humanizerMeta: {}
  }

  test('Privilege Humanizer', async () => {
    const expectedHumanization: Partial<HumanizerVisualization>[][] = [
      [
        { type: 'action', content: 'Enable' },
        {
          type: 'address',
          address: '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789'
        }
      ],
      [
        { type: 'action', content: 'Update access status' },
        { type: 'label', content: 'of' },
        {
          type: 'address',
          address: '0x6969174fd72466430a46e18234d0b530c9fd5f49'
        },
        { type: 'label', content: 'to' },
        {
          type: 'label',
          content: 'regular access'
        }
      ],
      [
        { type: 'action', content: 'Revoke access' },
        { type: 'label', content: 'of' },
        {
          type: 'address',
          address: '0x6969174fd72466430a46e18234d0b530c9fd5f49'
        }
      ]
    ]
    accountOp.calls = [...transactions.privileges]
    let irCalls: IrCall[] = accountOp.calls
    irCalls = privilegeHumanizer(accountOp, irCalls, humanizerInfo as HumanizerMeta)

    expect(irCalls.length).toBe(expectedHumanization.length)
    expectedHumanization.forEach(
      (callHumanization: Partial<HumanizerVisualization>[], i: number) => {
        callHumanization.forEach((h: Partial<HumanizerVisualization>, j: number) =>
          expect(irCalls[i]?.fullVisualization?.[j]).toMatchObject(h)
        )
      }
    )
  })
})
