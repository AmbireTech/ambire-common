import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getLabel } from '../../utils'
import SafeModule from '.'

const transactions = [
  {
    to: '0xF332bF49Da180E0c4814dC662d179020f31aE07D',
    value: 0n,
    data: '0x6a7612020000000000000000000000000bbbead62f7647ae8323d2cb243a0db74b7c2b800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001c00000000000000000000000000000000000000000000000000000000000000044a9059cbb0000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f49000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000820000000000000000000000004206d534CD8aCF86ba0eeC5ABb3c0B98EF7728dC000000000000000000000000000000000000000000000000000000000000000001a2df9e98285798df2bc8ba5368202ed950e153dee458fa9264dabf03722203d60a6ec8fc34f6dd0c745ef498795bf6bb00f32aec006af6fc94df3ac4b8284f1c1b000000000000000000000000000000000000000000000000000000000000'
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
  gasFeePayment: null
  // This is fed into the humanizer to help visualize the accountOp
  // This can contain info like the value of specific share tokens at the time of signing,
  // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
  // "remembered" at the time of signing in order to visualize history properly
  // humanizerMeta: {}
}
describe('Safe', () => {
  test('basic', () => {
    const expectedVisualization = [
      [
        getAction('Execute a Safe{WALLET} transaction'),
        getLabel('from'),
        getAddressVisualization('0xF332bF49Da180E0c4814dC662d179020f31aE07D'),
        getLabel('to'),
        getAddressVisualization('0x0BbbEad62f7647AE8323d2cb243A0DB74B7C2b80')
      ]
    ]
    const irCalls = SafeModule(accountOp, transactions, humanizerInfo as HumanizerMeta)
    compareHumanizerVisualizations(irCalls, expectedVisualization)
  })
})
