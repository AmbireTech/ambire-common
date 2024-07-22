import { ZeroAddress } from 'ethers'

import { expect } from '@jest/globals'

import { FEE_COLLECTOR } from '../../../../consts/addresses'
import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getDeadline, getLabel, getToken } from '../../utils'
import gasTankModule from '../GasTankModule'
import { genericErc20Humanizer } from '../Tokens'
import { uniswapHumanizer } from '../Uniswap'
import { getUniRecipientText } from '../Uniswap/utils'
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
  ],
  swapWrapReduce: [
    // swap is split into wrap and 2 swaps, total of 3 subcalls from the multicall
    {
      to: '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',
      value: 40000000000000000000n,
      data: '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000667195d300000000000000000000000000000000000000000000000000000000000000050b08000604000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000036000000000000000000000000000000000000000000000000000000000000003e0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000022b1c8c1227a00000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000020f5b1eaad8d800000000000000000000000000000000000000000009709c1c233c5dbd0524336a0f00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000761d38e5ddf6ccf6cf7c55759d5210750b5d60f3000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000001bc16d674ec8000000000000000000000000000000000000000000007e9b02785c11302ffa0094d500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48002710761d38e5ddf6ccf6cf7c55759d5210750b5d60f30000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000761d38e5ddf6ccf6cf7c55759d5210750b5d60f3000000000000000000000000000000fee13a103a10d593b9ae06b3e05f2e7e1c00000000000000000000000000000000000000000000000000000000000000190000000000000000000000000000000000000000000000000000000000000060000000000000000000000000761d38e5ddf6ccf6cf7c55759d5210750b5d60f300000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000009e92c7d41e8484ad0a00858dc'
    },
    // swap with withdraw
    {
      to: '0x337827814155ECBf24D20231fCA4444F530C0555',
      value: 14458487476752767n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000104db3e21980000000000000000000000004300000000000000000000000000000000000004000000000000000000000000430000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000001f400000000000000000000000020e9f0c7c59ded2167680b491f5ae61e2407a8af000000000000000000000000000000000000000000000000000000006675a3da000000000000000000000000000000000000000000000002b5e3af16b188000000000000000000000000000000000000000000000000000000335deaf20a917f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000412210e8a00000000000000000000000000000000000000000000000000000000'
    }
  ],
  // wrap and fuel gas tank with native
  gasTankTopupWithNative: [
    {
      to: '0x4200000000000000000000000000000000000006',
      value: 649637990000000n,
      data: '0xd0e30db0'
    },
    {
      to: '0x4200000000000000000000000000000000000006',
      value: 0n,
      data: '0xa9059cbb000000000000000000000000942f9ce5d9a33a82f88d233aeb3292e68023034800000000000000000000000000000000000000000000000000024ed7a1a06580'
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
    const expectedHumanization = [
      [
        getAction('Wrap'),
        getToken('0x0000000000000000000000000000000000000000', transactions.weth[0].value),
        getToken('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 0n, true)
      ],
      [
        getAction('Unwrap'),
        getToken('0x0000000000000000000000000000000000000000', 8900000000000000n),
        getToken('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 0n, true)
      ],
      []
    ]
    compareHumanizerVisualizations(irCalls, expectedHumanization)
  })
})
