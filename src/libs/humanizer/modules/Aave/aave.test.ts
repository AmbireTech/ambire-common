import { ZeroAddress } from 'ethers'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { Call } from '../../../accountOp/types'
import { HumanizerMeta, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'
import { aaveHumanizer } from '.'

const transactions: { [key: string]: Call[] } = {
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
    chainId: 1n,
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
    const expectedHumanization = [
      [
        getAction('Deposit'),
        getToken('0xae7ab96520de3a18e5e111b5eaab095312d7fe84', 11720186333766878310n),
        getLabel('to'),
        getAddressVisualization('0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9'),
        getLabel('on behalf of'),
        getAddressVisualization('0x7f4cf2e68f968cc050b3783268c474a15b8bdc2e')
      ],
      [
        getAction('Withdraw'),
        getToken(
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          115792089237316195423570985008687907853269984665640564039457584007913129639935n
        ),
        getLabel('from'),
        getAddressVisualization('0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9'),
        getLabel('on behalf of'),
        getAddressVisualization('0x8bc110db7029197c3621bea8092ab1996d5dd7be')
      ],
      [
        getAction('Deposit'),
        getToken(ZeroAddress, 135592697552000000n),
        getLabel('to'),
        getAddressVisualization('0xcc9a0b7c43dc2a5f023bb9b738e45b0ef6b06e04'),
        getLabel('on behalf of'),
        getAddressVisualization('0x47c353467326e6bd0c01e728e8f7d1a06a849395')
      ],
      [
        getAction('Withdraw'),
        getToken(ZeroAddress, 473401923n),
        getLabel('from'),
        getAddressVisualization('0xcc9a0b7c43dc2a5f023bb9b738e45b0ef6b06e04'),
        getLabel('on behalf of'),
        getAddressVisualization('0x0df1a69fcdf15fec04e37aa5eca4268927b111e7')
      ]
    ]
    accountOp.calls = [...transactions.aaveLendingPoolV2, ...transactions.aaveWethGatewayV2]
    let irCalls: IrCall[] = accountOp.calls
    irCalls = aaveHumanizer(accountOp, irCalls, humanizerInfo as HumanizerMeta)
    compareHumanizerVisualizations(irCalls, expectedHumanization)
  })
})
