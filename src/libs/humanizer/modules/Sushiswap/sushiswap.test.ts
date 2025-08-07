import { describe, expect } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { Call } from '../../../accountOp/types'
import { HumanizerMeta, HumanizerVisualization, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getLabel, getRecipientText, getToken } from '../../utils'
import { sushiSwapModule } from './sushiSwapModule'

const transactions: { [key: string]: Call[] } = {
  sushiSwapCalls: [
    {
      to: '0xE7eb31f23A5BefEEFf76dbD2ED6AdC822568a5d2',
      value: 0n,
      data: '0x2646478b0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000016bcc41e900000000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a06300000000000000000000000000000000000000000000000000013d425a52399d0000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f4900000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000042020d500B1d8E8eF31E21C99d1Db9A6444d3ADf127001ffff008929D3FEa77398F64448c85015633c2d6472fB29016969174FD72466430a46e18234D0b530c9FD5f49000000000000000000000000000000000000000000000000000000000000'
    }
  ]
}

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

describe('sushiSwap', () => {
  test('basic', () => {
    const expectedhumanization: HumanizerVisualization[] = [
      getAction('Swap'),
      getToken('0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', 400000000000000n),
      getLabel('for'),
      getToken('0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', 348830169184669n),
      ...getRecipientText(
        '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
        '0x6969174fd72466430a46e18234d0b530c9fd5f49'
      )
    ]
    accountOp.calls = [...transactions.sushiSwapCalls]
    let irCalls: IrCall[] = accountOp.calls
    irCalls = sushiSwapModule(accountOp, irCalls, humanizerInfo as HumanizerMeta)
    expect(irCalls.length).toBe(1)
    compareHumanizerVisualizations(irCalls, [expectedhumanization])
  })
})
