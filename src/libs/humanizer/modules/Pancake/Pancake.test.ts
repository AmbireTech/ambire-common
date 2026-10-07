import { encodeFunctionData, maxUint160, parseAbi } from 'viem'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken,
  getUnlimitedApprovalWarning
} from '../../utils'
import OneInchModule from './'

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
  id: 'pancake-id',
  gasLimit: null,
  signature: null,
  gasFeePayment: null
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
          1461501637330902918203684832716283019655932542975n,
          undefined,
          undefined,
          {
            spenderAddr: '0xFE6508f0015C778Bdcc1fB5465bA5ebE224C9912',
            expiration: 1746289513n
          }
        ),
        getDeadline(1746289513n)
      ]
    ]
    const irCalls = transactions.map((c) =>
      OneInchModule(accountOp, c, humanizerInfo as HumanizerMeta)
    )
    compareHumanizerVisualizations(irCalls, expectedVisualization)
  })

  // this calldata would still execute onchain - the missing trailing `expiration` word is
  // read as zero by the EVM - so the humanizer has to decode it the same way and still show
  // the unlimited approval warning, rather than silently dropping the whole call
  test('still warns about an unlimited approval when the trailing expiration word is missing', () => {
    const token = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    const spender = '0xFE6508f0015C778Bdcc1fB5465bA5ebE224C9912'
    const approveAbi = parseAbi([
      'function approve(address token, address spender, uint160 amount, uint48 expiration)'
    ])
    const fullData = encodeFunctionData({
      abi: approveAbi,
      args: [token, spender, maxUint160, 1746289513]
    })
    const call: IrCall = {
      to: '0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768',
      value: 0n,
      data: fullData.slice(0, -64)
    }

    const irCall = OneInchModule(accountOp, call, humanizerInfo as HumanizerMeta)
    compareHumanizerVisualizations(
      [irCall],
      [
        [
          getAction('Approve'),
          getAddressVisualization(spender),
          getLabel('to use'),
          getToken(token, maxUint160),
          getLabel('now')
        ]
      ]
    )
    expect(irCall.warnings).toEqual([getUnlimitedApprovalWarning(spender)])
  })
})
