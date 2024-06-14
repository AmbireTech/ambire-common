import { ZeroAddress } from 'ethers'
import { AccountOp } from 'libs/accountOp/accountOp'

import { expect } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { HumanizerMeta, HumanizerVisualization, IrCall } from '../../interfaces'
import { getAction, getLabel, getToken } from '../../utils'
import { wrappingModule } from './wrapping'

const TETHER_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

const transactions = {
  weth: [
    // deposit
    {
      to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      value: 1000000000000000000n,
      data: '0xd0e30db0'
    },
    // withdraw
    {
      to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      value: 1000000000000000000n,
      data: '0x2e1a7d4d000000000000000000000000000000000000000000000000001f9e80ba804000'
    },
    // should not enter weth module, should be Call deposit(), a func not in UniV3
    {
      to: '0xe592427a0aece92de3edee1f18e0157c05861564',
      value: 1000000000000000000n,
      data: '0xd0e30db0'
    }
  ]
}
describe('wrapping', () => {
  const accountOp: AccountOp = {
    accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
    networkId: 'ethereum',
    // networkId: 'polygon',
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
  test('WETH', () => {
    accountOp.calls = [...transactions.weth]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = wrappingModule(accountOp, irCalls, humanizerInfo as HumanizerMeta)
    expect(irCalls[0].fullVisualization?.length).toBe(3)
    expect(irCalls[0]?.fullVisualization![0]).toMatchObject({ type: 'action', content: 'Wrap' })
    expect(irCalls[0]?.fullVisualization![1]).toMatchObject({
      type: 'token',
      address: '0x0000000000000000000000000000000000000000',
      amount: transactions.weth[0].value
    })
    expect(irCalls[0]?.fullVisualization![2]).toMatchObject({
      type: 'token',
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      amount: 0n,
      isHidden: true
    })

    expect(irCalls[1].fullVisualization?.length).toBe(3)
    expect(irCalls[1]?.fullVisualization![0]).toMatchObject({ type: 'action', content: 'Unwrap' })
    expect(irCalls[1]?.fullVisualization![1]).toMatchObject({
      type: 'token',
      address: '0x0000000000000000000000000000000000000000',
      amount: 8900000000000000n
    })
    expect(irCalls[0]?.fullVisualization![2]).toMatchObject({
      type: 'token',
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      amount: 0n,
      isHidden: true
    })
  })

  test('SWAP WRAP/UNWRAPS', () => {
    const placeholder = '0x123456789'
    const calls: IrCall[] = [
      {
        to: placeholder,
        data: placeholder,
        value: 0n,
        fullVisualization: [
          getAction('Swap'),
          getToken(TETHER_ADDRESS, 1000000000n),
          getLabel(placeholder),
          getToken(WETH_ADDRESS, 1000000000n)
        ]
      },
      {
        to: WETH_ADDRESS,
        data: placeholder,
        value: 0n,
        fullVisualization: [getAction('Unwrap'), getToken(ZeroAddress, 1000000000n)]
      }
    ]

    const expectedHumanization = [
      { type: 'action', content: 'Swap' },
      {
        type: 'token',
        address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        amount: 1000000000n
      },
      { type: 'label', content: '0x123456789' },
      {
        type: 'token',
        address: '0x0000000000000000000000000000000000000000',
        amount: 1000000000n
      }
    ]

    const [newCalls] = wrappingModule(accountOp, calls, humanizerInfo as HumanizerMeta)
    expect(newCalls.length).toBe(1)
    newCalls[0].fullVisualization?.map((v: HumanizerVisualization, i: number) =>
      expect(v).toMatchObject(expectedHumanization[i])
    )
  })
})
