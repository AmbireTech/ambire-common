import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getToken } from '../../utils'
import { LidoModule } from './'

// @TODO
// https://github.com/AmbireTech/ambire-app/issues/2376
const transactions = [
  // lido wrap steth
  {
    to: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
    value: 0n,
    data: '0xea598cb000000000000000000000000000000000000000000000000000000000000186a0'
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
      [getAction('Wrap'), getToken('0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', 100000n)]
    ]
    const irCalls = LidoModule(accountOp, transactions, humanizerInfo as HumanizerMeta)
    compareHumanizerVisualizations(irCalls, expectedVisualization)
  })
})
