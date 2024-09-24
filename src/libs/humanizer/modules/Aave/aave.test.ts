import { expect } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, HumanizerVisualization, IrCall } from '../../interfaces'
import { aaveHumanizer } from './'

const transactions: { [key: string]: Array<IrCall> } = {
  aaveLendingPoolV2: [
    // deposit
    {
      to: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
      value: 0n,
      data: '0xe8eda9df000000000000000000000000ae7ab96520de3a18e5e111b5eaab095312d7fe84000000000000000000000000000000000000000000000000a2a6775fd59004660000000000000000000000007f4cf2e68f968cc050b3783268c474a15b8bdc2e0000000000000000000000000000000000000000000000000000000000000000'
    },
    // withdraw
    {
      to: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
      value: 0n,
      data: '0x69328dec000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000008bc110db7029197c3621bea8092ab1996d5dd7be'
    }
  ],
  aaveWethGatewayV2: [
    // deposit
    {
      to: '0xcc9a0B7c43DC2a5F023Bb9b738E45B0Ef6B06E04',
      value: 135592697552000000n,
      data: '0x474cf53d0000000000000000000000007d2768de32b0b80b7a3454c06bdac94a69ddc7a900000000000000000000000047c353467326e6bd0c01e728e8f7d1a06a84939500000000000000000000000000000000000000000000000000000000000000bb'
    },
    // withdraw
    {
      to: '0xcc9a0B7c43DC2a5F023Bb9b738E45B0Ef6B06E04',
      value: 0n,
      data: '0x80500d200000000000000000000000007d2768de32b0b80b7a3454c06bdac94a69ddc7a9000000000000000000000000000000000000000000000000000000001c378a430000000000000000000000000df1a69fcdf15fec04e37aa5eca4268927b111e7'
    }
  ]
}

describe('AAVE', () => {
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
  test('AAVE', () => {
    const expectedhumanization = [
      [
        { content: 'Deposit' },
        { type: 'token' },
        { content: 'to Aave lending pool' },
        { content: 'on behalf of' },
        { type: 'address' }
      ],
      [
        { content: 'Withdraw' },
        { type: 'token' },
        { content: 'from Aave lending pool' },
        { content: 'on behalf of' },
        { type: 'address' }
      ],
      [
        { content: 'Deposit' },
        { type: 'token' },
        { content: 'to Aave lending pool' },
        { content: 'on behalf of' },
        { type: 'address' }
      ],
      [
        { content: 'Withdraw' },
        { type: 'token' },
        { content: 'from Aave lending pool' },
        { content: 'on behalf of' },
        { type: 'address' }
      ]
    ]
    accountOp.calls = [...transactions.aaveLendingPoolV2, ...transactions.aaveWethGatewayV2]
    let irCalls: IrCall[] = accountOp.calls
    irCalls = aaveHumanizer(accountOp, irCalls, humanizerInfo as HumanizerMeta)
    irCalls.forEach((c, i) =>
      c?.fullVisualization?.forEach((v: HumanizerVisualization, j: number) =>
        expect(v).toMatchObject(expectedhumanization[i][j])
      )
    )
  })
})
