import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getToken } from '../../utils'
import { wrappingModule } from './wrapping'

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
  test('WETH', () => {
    accountOp.calls = [...transactions.weth]
    let irCalls: IrCall[] = accountOp.calls
    irCalls = wrappingModule(accountOp, irCalls, humanizerInfo as HumanizerMeta)
    const expectedHumanization = [
      [
        getAction('Wrap'),
        getToken('0x0000000000000000000000000000000000000000', transactions.weth[0].value)
      ],
      [
        getAction('Unwrap'),
        getToken('0x0000000000000000000000000000000000000000', 8900000000000000n)
      ],
      []
    ]
    compareHumanizerVisualizations(irCalls, expectedHumanization)
  })
})
