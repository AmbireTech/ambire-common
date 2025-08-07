import { ZeroAddress } from 'ethers'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import {
  getAction,
  getChain,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken,
  getTokenWithChain
} from '../../utils'
import AcrossModule from '.'

const transactions = [
  // bridge via depositV3
  {
    to: '0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096',
    value: 0n,
    data: '0x7b9392320000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f490000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f490000000000000000000000003c499c542cef5e3811e1192ce70d8cc03d5c3359000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831000000000000000000000000000000000000000000000000000000000001fe20000000000000000000000000000000000000000000000000000000000001a47f000000000000000000000000000000000000000000000000000000000000a4b100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000066704d77000000000000000000000000000000000000000000000000000000006670a23a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000000000000000000001dc0de0000'
  },
  // bridge via deposit (from Missing humanizations in ambire-common issue)
  {
    to: '0x6f26Bf09B1C792e3228e5467807a900A503c0281',
    value: 0n,
    data: '0x1186ec330000000000000000000000005f46a9f7e04d78fdb38de0c975d9ca07925fe5b000000000000000000000000094b008aa00579c1307b0ef2c499ad98a8ce58e580000000000000000000000000000000000000000000000000000000001312d00000000000000000000000000000000000000000000000000000000000000a4b1000000000000000000000000000000000000000000000000015723eff09016ee0000000000000000000000000000000000000000000000000000000065f2c0140000000000000000000000000000000000000000000000000000000000000100ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000000000000'
  },
  // bridge native via deposit (live from the dapp)
  {
    to: '0xb4a8d45647445ea9fc3e1058096142390683dbc2',
    value: 11662072378005407n,
    data: '0xe0db3fcf0000000000000000000000005c7bcd6e7de5423a257d81b442095a1a6ced35c5000000000000000000000000d819a17345efa4f014f289b999d6f79215cff974000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000002386f26fc10000000000000000000000000000000000000000000000000000000000000000a4b10000000000000000000000000000000000000000000000000001de78a7a5567c0000000000000000000000000000000000000000000000000000000066713d8f0000000000000000000000000000000000000000000000000000000000000120ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000000001dc0de0000'
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
const ARBITRUM_CHAIN_ID = 42161n
describe('Across', () => {
  test('basic', () => {
    const expectedVisualization = [
      [
        getAction('Bridge'),
        getToken('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', 130592n),
        getLabel('for'),
        getTokenWithChain('0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 107647n, ARBITRUM_CHAIN_ID),
        getLabel('to'),
        getChain(ARBITRUM_CHAIN_ID),
        getDeadline(1718657594n)
      ],
      [
        getAction('Bridge'),
        getToken('0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', 20000000n),
        getLabel('to'),
        getChain(ARBITRUM_CHAIN_ID),
        ...getRecipientText('arbitrary address', '0x5f46a9f7e04d78fdb38de0c975d9ca07925fe5b0')
      ],
      [
        getAction('Bridge'),
        getToken('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 10000000000000000n),
        getLabel('to'),
        getChain(42161n),
        ...getRecipientText(ZeroAddress, '0xd819A17345efA4f014F289b999d6f79215cff974')
      ]
    ]
    const irCalls = AcrossModule(accountOp, transactions, humanizerInfo as HumanizerMeta)
    compareHumanizerVisualizations(irCalls, expectedVisualization)
  })
})
