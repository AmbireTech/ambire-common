import { ZeroAddress } from 'ethers'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getLabel, getRecipientText, getToken } from '../../utils'
import OneInchModule from '.'

// @TODO
// https://github.com/AmbireTech/ambire-app/issues/2376
const transactions = [
  // cancel order
  {
    to: '0x111111125421cA6dc452d289314280a0f8842A65',
    value: 0n,
    data: '0xb68fb0208a000000000000000000000012540000000066719134000000000000000000008251f6b93acf78f5f41c61edfcfe708ea5c5068a1b9227001eafe3811e524471'
  },
  // unoswap2
  {
    to: '0x111111125421ca6dc452d289314280a0f8842a65',
    value: 0n,
    data: '0x8770ba91000000000000000000000000c3ec80343d2bae2f8e680fdadde7c17e71e114ea00000000000000000000000000000000000000000000000001aacac053770b47000000000000000000000000000000000000000000000000000000000001339008000000000000003b6d0340ff2bbcb399ad50bbd06debadd47d290933ae103800000000000000003b8b87c0bdd5e7d186ec062cc46c0fb52a48f52827baf941e26b9977'
  },
  // swap() pol for wmatc via swap
  {
    to: '0x111111125421ca6dc452d289314280a0f8842a65',
    value: 11021000000000000000n,
    data: '0x07ed2379000000000000000000000000e37e799d5077682fa0a244d46e5649f71457bd09000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000e37e799d5077682fa0a244d46e5649f71457bd09000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000098f2751bb5948000000000000000000000000000000000000000000000000000982eaf67173b70000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000b400000000000000000000000000000000000000000000009600006800001a40610d500b1d8e8ef31e21c99d1db9a6444d3adf1270d0e30db080206c4eca270d500b1d8e8ef31e21c99d1db9a6444d3adf1270111111125421ca6dc452d289314280a0f8842a6500000000000000000000000000000000000000000000000098f2751bb59480000020d6bdbf780d500b1d8e8ef31e21c99d1db9a6444d3adf1270111111125421ca6dc452d289314280a0f8842a65000000000000000000000000e26b9977'
  },
  // pol for usdc via ethUnoswap(uint256,uint256)
  {
    to: '0x111111125421ca6dc452d289314280a0f8842a65',
    value: 301049290996040n,
    data: '0xa76dfc3b00000000000000000000000000000000000000000000000000000000000000a200800000000000003b6d03406d9e8dbb2779853db00418d4dcf96f3987cfc9d2e26b9977'
  },
  // unoswap
  {
    to: '0x111111125421ca6dc452d289314280a0f8842a65',
    value: 0n,
    data: '0x83800a8e0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000000000000000000000000000000061a6eac6f128a100000000000000000000000000000000000000000000000000b16f2e7c0ae66a18000000000000003b6d0340eef611894ceae652979c9d0dae1deb597790c6ee2a6f45f2'
  },
  // unoswapTo swap USDC to DAI
  {
    to: '0x111111125421cA6dc452d289314280a0f8842A65',
    value: 0n,
    data: '0xe2c95c8200000000000000000000000075dca6377c1a3365c98e8c63abe36ced51546723000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f00000000000000000000000000000000000000000000000000000000001e84800000000000000000000000000000000000000000000000001ba26140b741b88708000000000000003b6d034059153f27eefe07e5ece4f9304ebba1da6f53ca88e26b9977'
  },
  // unoswap3
  {
    to: '0x111111125421cA6dc452d289314280a0f8842A65',
    value: 0n,
    data: '0x193674720000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a06300000000000000000000000000000000000000000000001ab9bfd7f95b940000000000000000000000000000000000000000000000000001fecab348d039673748000300031000100a0000001d8b86e3d88cdb2d34688e87e72f388cb541b7c82000000000000000000000006b75f2189f0e11c52e814e09e280eb1a9a8a094a2080000000000000000000000a28c2f5e0e8463e047c203f00f649812ae67e4fddc5239b'
  }
]
const accountOp: AccountOp = {
  accountAddr: '0x6969174FD72466430a46e18234D0b530c9FD5f49',
  chainId: 42161n,
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
describe('1Inch', () => {
  test('basic', () => {
    const expectedVisualization = [
      [getAction('Cancel order'), getLabel('with order hash 0x825...471')],
      [
        getAction('Swap'),
        getToken('0xc3ec80343d2bae2f8e680fdadde7c17e71e114ea', 120131267461581639n)
      ],
      [
        getAction('Swap'),
        getToken('0x0000000000000000000000000000000000000000', 11021000000000000000n),
        getLabel('for'),
        getToken('0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', 10965895000000000000n),
        ...getRecipientText(accountOp.accountAddr, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
      ],
      [getAction('Swap'), getToken(ZeroAddress, 301049290996040n)],
      [
        getAction('Swap'),
        getToken('0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', 27486600031185057n)
      ],
      [getAction('Swap'), getToken('0xc2132d05d31c914a87c6611c10748aeb04b58e8f', 2000000n)],
      [
        getAction('Swap'),
        getToken('0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', 493000000000000000000n)
      ]
    ]
    const irCalls = OneInchModule(accountOp, transactions, humanizerInfo as HumanizerMeta)
    compareHumanizerVisualizations(irCalls, expectedVisualization)
  })
})
