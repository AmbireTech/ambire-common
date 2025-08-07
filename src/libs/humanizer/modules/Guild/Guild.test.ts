import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getLabel } from '../../utils'
import OneInchModule from '.'

const transactions = [
  {
    to: '0xff04820c36759c9f5203021fe051239ad2dcca8a',
    value: 5000000000000000000n,
    data: '0xdc4b201d00000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000067d97e5e00000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000002200000000000000000000000001b26e648fa19ca6d081d27c9bb1fc0ddd6ed556200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000779c2e000000000000000000000000000000000000000000000000000000000000260800000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000067d41532000000000000000000000000000000000000000000000000000000000000000d416d626972652057616c6c657400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002e516d62424d5357446b6d765645566b446e42384b6b38486f3238733134565a4c786e6f39684b42776839454251740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041ae1e0a6b6491c6be3e06a278b1b1dcc707a5b3c78bbbfad17cb546bc28778dbe2efc9367e6c2e07fedee403ac346645c17bfbdc3c4afbd4db570eb3f10710dd71b00000000000000000000000000000000000000000000000000000000000000'
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
describe('Guild', () => {
  test('basic', () => {
    const expectedVisualization = [
      [getAction('Claim Guild badge'), getLabel('for'), getLabel('Ambire Wallet', true)]
    ]
    const irCalls = OneInchModule(accountOp, transactions, humanizerInfo as HumanizerMeta)
    compareHumanizerVisualizations(irCalls, expectedVisualization)
  })
})
