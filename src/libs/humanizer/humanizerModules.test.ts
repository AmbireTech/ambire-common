import { describe, expect, test } from '@jest/globals'

import { AccountOp } from '../accountOp/accountOp'
import { callsToIr, initHumanizerMeta } from './humanizer'

import { uniswapHumanizer } from './modules/Uniswap'
import { Ir } from './interfaces'
import { wethHumanizer } from './modules/weth'
import { aaveHumanizer } from './modules/Aave'

const humanizerInfo = initHumanizerMeta(require('../../consts/humanizerInfo.json'))

const accountOp: AccountOp = {
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  networkId: '1',
  // this may not be defined, in case the user has not picked a key yet
  signingKeyAddr: null,
  // this may not be set in case we haven't set it yet
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null,
  // This is used when we have an account recovery to finalize before executing the AccountOp,
  // And we set this to the recovery finalization AccountOp; could be used in other scenarios too in the future,
  // for example account migration (from v1 QuickAcc to v2)
  accountOpToExecuteBefore: null,
  // This is fed into the humanizer to help visualize the accountOp
  // This can contain info like the value of specific share tokens at the time of signing,
  // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
  // "remembered" at the time of signing in order to visualize history properly
  humanizerMeta: {}
}
const transactions = {
  uniV3Multicalls: [
    // first part of this has recipient 0x000...000. idk why
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      value: 100000000n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001c00000000000000000000000000000000000000000000000000000000000000144c04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000610744c1000000000000000000000000000000000000000000000006a5f226c6bca6fa750000000000000000000000000000000000000000000000000039ac0e6684b18b0000000000000000000000000000000000000000000000000000000000000042f65b5c5104c4fafd4b709d9d60a185eae063276c002710a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480001f4c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c0000000000000000000000000000000000000000000000000039ac0e6684b18b00000000000000000000000060a293703cfb82b398c48668d55f510d339a3e1c00000000000000000000000000000000000000000000000000000000'
    },
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      value: 0n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000104414bf38900000000000000000000000026ab1c0e34422caa85f73ccebb8e5eafe2e6b03b000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000064db6b530000000000000000000000000000000000000000000016c0201616d1bf32170d00000000000000000000000000000000000000000000000005216fd8055da496000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c00000000000000000000000000000000000000000000000005216fd8055da4960000000000000000000000008919dc5c37e5297aa58b4c4b7de442ecfe0a9a7000000000000000000000000000000000000000000000000000000000'
    },
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      value: 0n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000104414bf389000000000000000000000000225735d708eab6813616e1eeffdd79c7a10460a4000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000064db6adb00000000000000000000000000000000000000000000236fa84f4c7faa7723410000000000000000000000000000000000000000000000000876022c89d962f1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c0000000000000000000000000000000000000000000000000876022c89d962f1000000000000000000000000a8bc3c6598d7812925863d2d58e8280d5000000100000000000000000000000000000000000000000000000000000000'
    },
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      value: 700000000000000000n,
      data: '0xac9650d80000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000104414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000e8a3bf796ca5a13283ec6b1c5b645b91d7cfef5d0000000000000000000000000000000000000000000000000000000000000bb800000000000000000000000037a4d0ff423e9d0c597836bb0a7fe4c3cdb6e5ff0000000000000000000000000000000000000000000000000000000064ddcfd400000000000000000000000000000000000000000000000009b6e64a8ec600000000000000000000000000000000000000000000000000b9fac2645641bb1d22000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    }
  ],
  weth: [
    // deposit
    {
      to: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      value: 1000000000000000000n,
      data: '0xd0e30db0'
    },
    // withdraw
    {
      to: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      value: 1000000000000000000n,
      data: '0x2e1a7d4d000000000000000000000000000000000000000000000000001f9e80ba804000'
    },
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      value: 1000000000000000000n,
      data: '0xd0e30db0'
    }
  ],
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
  ],
  // @TODO add proper example calls
  WALLET: []
}

describe('module tests', () => {
  beforeEach(async () => {
    accountOp.humanizerMeta = { ...humanizerInfo }
    accountOp.calls = []
  })
  test('uniV3', () => {
    const expectedhumanization = [
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0xf65B5C5104c4faFD4b709d9D60a185eAE063276c',
          amount: 122638127037889837685n
        },
        { type: 'lable', content: 'for at least' },
        {
          type: 'token',
          address: '0x0000000000000000000000000000000000000000',
          amount: 16233251521999243n
        },
        { type: 'lable', content: 'and send it to' },
        {
          type: 'address',
          address: '0x0000000000000000000000000000000000000000'
        },
        { type: 'lable', content: 'already expired' }
      ],
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0x26ab1c0e34422Caa85f73ccEbb8E5EafE2E6B03b',
          amount: 107436149545833241646861n
        },
        { type: 'lable', content: 'for at least' },
        {
          type: 'token',
          address: '0x0000000000000000000000000000000000000000',
          amount: 369699618014733462n
        },
        // @TODO debug recipient = 0x000...000
        { type: 'lable', content: 'and send it to' },
        {
          type: 'address',
          address: '0x0000000000000000000000000000000000000000'
        },
        { type: 'lable', content: 'already expired' }
      ],
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0x225735D708EAb6813616e1EeFfDd79C7A10460A4',
          amount: 167342543489052079235905n
        },
        { type: 'lable', content: 'for at least' },
        {
          type: 'token',
          address: '0x0000000000000000000000000000000000000000',
          amount: 609677189869822705n
        },
        { type: 'lable', content: 'and send it to' },
        {
          type: 'address',
          address: '0x0000000000000000000000000000000000000000'
        },
        { type: 'lable', content: 'already expired' }
      ],
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          amount: 700000000000000000n
        },
        { type: 'lable', content: 'for at least' },
        {
          type: 'token',
          address: '0xe8A3Bf796cA5a13283ec6B1c5b645B91D7CfEf5D',
          amount: 3430716768612863647010n
        },
        { type: 'lable', content: 'and send it to' },
        {
          type: 'address',
          address: '0x37a4d0fF423e9d0c597836Bb0a7Fe4c3Cdb6E5ff'
        },
        { type: 'lable', content: 'already expired' }
      ]
    ]
    accountOp.calls = [...transactions.uniV3Multicalls]
    let ir: Ir = callsToIr(accountOp)
    ;[ir] = uniswapHumanizer(accountOp, ir)
    ir.calls.forEach((c, i) => {
      expect(c.fullVisualization.length).toEqual(expectedhumanization[i].length)
      c.fullVisualization.forEach((v: any, j: number) => {
        expect(v).toEqual(expectedhumanization[i][j])
      })
    })
  })
  test('WETH', () => {
    accountOp.calls = [...transactions.weth]
    let ir: Ir = callsToIr(accountOp)
    ;[ir] = wethHumanizer(accountOp, ir)
    expect(ir.calls[0].fullVisualization).toEqual([
      { type: 'action', content: 'Wrap' },
      {
        type: 'token',
        address: '0x0000000000000000000000000000000000000000',
        amount: transactions.weth[0].value
      }
    ])
    expect(ir.calls[1].fullVisualization).toEqual([
      { type: 'action', content: 'Unwrap' },
      {
        type: 'token',
        address: '0x0000000000000000000000000000000000000000',
        amount: 8900000000000000n
      }
    ])
    expect(ir.calls[2].fullVisualization).toBeNull()
  })
  test('AAVE', () => {
    const expectedhumanization = [
      [
        { content: 'Deposit' },
        { type: 'token' },
        { content: 'to Aave lending pool' },
        { content: 'on befalf of' },
        { type: 'address' }
      ],
      [
        { content: 'Withdraw' },
        { type: 'token' },
        { content: 'from Aave lending pool' },
        { content: 'on befalf of' },
        { type: 'address' }
      ],
      [
        { content: 'Deposit' },
        { type: 'token' },
        { content: 'to Aave lending pool' },
        { content: 'on befalf of' },
        { type: 'address' }
      ],
      [
        { content: 'Withdraw' },
        { type: 'token' },
        { content: 'from Aave lending pool' },
        { content: 'on befalf of' },
        { type: 'address' }
      ]
    ]
    accountOp.calls = [...transactions.aaveLendingPoolV2, ...transactions.aaveWethGatewayV2]
    let ir: Ir = callsToIr(accountOp)
    ;[ir] = aaveHumanizer(accountOp, ir)
    ir.calls.forEach((c, i) =>
      c.fullVisualization.forEach((v: any, j: number) =>
        expect(v).toMatchObject(expectedhumanization[i][j])
      )
    )
  })
  test('WALLET', () => {
    // const expectedhumanization = []
    accountOp.calls = [...transactions.WALLET]
    let ir: Ir = callsToIr(accountOp)
    ;[ir] = aaveHumanizer(accountOp, ir)
    // ir.calls.forEach((c, i) =>
    //   c.fullVisualization.forEach((v: any, j: number) =>
    //     expect(v).toMatchObject(expectedhumanization[i][j])
    //   )
    // )
    ir.calls.forEach((call) => console.log(call.fullVisualization))
  })
})
