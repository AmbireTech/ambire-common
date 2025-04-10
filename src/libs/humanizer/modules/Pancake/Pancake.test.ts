import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../../utils'
import OneInchModule from '.'

const transactions = [
  {
    to: '0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768',
    value: 0n,
    data: '0x87517c45000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000fe6508f0015c778bdcc1fb5465ba5ebe224c9912000000000000000000000000ffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000068164369'
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
describe('Pancake', () => {
  test('basic', () => {
    const expectedVisualization = [
      [
        getAction('Approve'),
        getAddressVisualization('0xFE6508f0015C778Bdcc1fB5465bA5ebE224C9912'),
        getLabel('to use'),
        getToken(
          '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          1461501637330902918203684832716283019655932542975n
        ),
        getDeadline(1746289513n)
      ]
    ]
    const irCalls = OneInchModule(accountOp, transactions, humanizerInfo as HumanizerMeta)
    compareHumanizerVisualizations(irCalls, expectedVisualization)
  })
})
