import { describe, expect, test } from '@jest/globals'

import { encodeFunctionData, getAddress, parseAbi } from 'viem'

import { LidoModule } from '.'
import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'

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
  id: 'lido-id',
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
describe('Lido', () => {
  test('basic', () => {
    const expectedVisualization = [
      [getAction('Wrap'), getToken('0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', 100000n)]
    ]
    const irCalls = transactions.map((c) =>
      LidoModule(accountOp, c, humanizerInfo as HumanizerMeta)
    )
    compareHumanizerVisualizations(irCalls, expectedVisualization)
  })

  describe('claimWithdrawalsTo', () => {
    const abi = parseAbi([
      'function claimWithdrawalsTo(uint256[] _requestIds, uint256[] _hints, address _recipient)'
    ])
    const withdrawalQueueAddress = '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1'

    test('BUG: includes the recipient when claiming withdrawals to another address', () => {
      const recipient = '0x1234567890123456789012345678901234567890'
      const call = {
        to: withdrawalQueueAddress,
        value: 0n,
        data: encodeFunctionData({
          abi,
          functionName: 'claimWithdrawalsTo',
          args: [[1n, 2n], [0n, 0n], recipient]
        })
      }

      const irCall = LidoModule(accountOp, call, humanizerInfo as HumanizerMeta)

      compareHumanizerVisualizations(
        [irCall],
        [
          [
            getAction('Claim withdrawal'),
            getLabel('and send to'),
            getAddressVisualization(recipient)
          ]
        ]
      )
      expect(irCall.data).toBe(call.data)
      expect(irCall.to).toBe(call.to)
      expect(irCall.value).toBe(call.value)
    })

    test.each([getAddress(accountOp.accountAddr), accountOp.accountAddr.toLowerCase()])(
      'omits the recipient label when claiming to the account %s',
      (accountAddr) => {
        const call = {
          to: withdrawalQueueAddress,
          value: 0n,
          data: encodeFunctionData({
            abi,
            functionName: 'claimWithdrawalsTo',
            args: [[1n], [0n], getAddress(accountOp.accountAddr)]
          })
        }

        const irCall = LidoModule(
          { ...accountOp, accountAddr },
          call,
          humanizerInfo as HumanizerMeta
        )

        compareHumanizerVisualizations([irCall], [[getAction('Claim withdrawal')]])
      }
    )
  })
})
