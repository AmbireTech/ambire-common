import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { getPrivacyPoolsChainConfig } from '../../../../consts/privacyPools'
import { encodePrivacyPoolsDeposit } from '../../../privacyPools/deposit'
import { HumanizerVisualization, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import {
  getAction,
  getAddressVisualization,
  getErc7730Visualization,
  getLabel,
  getToken
} from '../../utils'
import { humanizePrivacyPoolsWithdrawal, privacyPoolsModule } from './privacyPoolsModule'

const ENTRYPOINT = getPrivacyPoolsChainConfig(1n)!.entrypointAddress
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const RECIPIENT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const accountOp = { chainId: 1n } as any

const humanize = (calls: IrCall[], op = accountOp) =>
  calls.map((call) => privacyPoolsModule(op, call, {} as any))

describe('Privacy Pools humanizer', () => {
  test('describes a deposit as a transfer to a Privacy Pools account', () => {
    const calls: IrCall[] = [
      {
        to: ENTRYPOINT,
        ...encodePrivacyPoolsDeposit({
          isNative: true,
          assetAddress: ZeroAddress,
          amount: 10n ** 18n,
          precommitment: 42n
        })
      },
      {
        to: ENTRYPOINT,
        ...encodePrivacyPoolsDeposit({
          isNative: false,
          assetAddress: USDC,
          amount: 5_000_000n,
          precommitment: 42n
        })
      }
    ]
    const expectedVisualizations: HumanizerVisualization[][] = [
      [
        getAction('Send'),
        getToken(ZeroAddress, 10n ** 18n),
        getLabel('to a Privacy Pools account')
      ],
      [getAction('Send'), getToken(USDC, 5_000_000n), getLabel('to a Privacy Pools account')]
    ]

    compareHumanizerVisualizations(humanize(calls), expectedVisualizations)
  })

  test('leaves other calls alone, including a deposit on a network without Privacy Pools', () => {
    const deposit = {
      to: ENTRYPOINT,
      ...encodePrivacyPoolsDeposit({
        isNative: true,
        assetAddress: ZeroAddress,
        amount: 1n,
        precommitment: 1n
      })
    }
    const otherEntrypointCall = { to: ENTRYPOINT, value: 0n, data: '0x12345678' }
    const depositElsewhere = { ...deposit, to: '0x000000000000000000000000000000000000dEaD' }

    const [onOtherNetwork] = humanize([deposit], { chainId: 137n } as any)
    const [unknownCall, notEntrypoint] = humanize([otherEntrypointCall, depositElsewhere])

    expect(onOtherNetwork).toEqual(deposit)
    expect(unknownCall).toEqual(otherEntrypointCall)
    expect(notEntrypoint).toEqual(depositElsewhere)
  })

  describe('a withdrawal', () => {
    const withdrawal = {
      recipient: RECIPIENT,
      tokenAddress: USDC,
      amount: 5_000_000n,
      fee: 300_000n,
      noteCount: 2
    }

    /**
     * The clear-signing card a withdrawal of `amount` is shown as - with what the recipient gets
     * when the expected fee is known.
     */
    const expectedCard = (
      tokenAddress: string,
      amount: bigint,
      expectedFeeAmount: bigint | null
    ): HumanizerVisualization[] => [
      getErc7730Visualization('Send', [
        { type: 'single-value', label: 'Amount to Send', value: getToken(tokenAddress, amount) },
        ...(expectedFeeAmount === null
          ? []
          : [
              {
                type: 'single-value' as const,
                label: 'Estimated to Receive',
                value: getToken(tokenAddress, amount - expectedFeeAmount)
              }
            ]),
        { type: 'single-value', label: 'Recipient', value: getAddressVisualization(RECIPIENT) }
      ])
    ]

    test('shows what leaves the account, what the recipient is expected to get and who it is', () => {
      compareHumanizerVisualizations(
        [humanizePrivacyPoolsWithdrawal({ withdrawal, expectedFeeAmount: 120_000n })],
        [expectedCard(USDC, 5_000_000n, 120_000n)]
      )
    })

    test('shows the whole amount reaching the recipient when the fee is fully refunded', () => {
      compareHumanizerVisualizations(
        [humanizePrivacyPoolsWithdrawal({ withdrawal, expectedFeeAmount: 0n })],
        [expectedCard(USDC, 5_000_000n, 0n)]
      )
    })

    test('leaves out what the recipient gets rather than show it net of the fee cap', () => {
      compareHumanizerVisualizations(
        [humanizePrivacyPoolsWithdrawal({ withdrawal, expectedFeeAmount: null })],
        [expectedCard(USDC, 5_000_000n, null)]
      )
    })

    test('describes native ETH by the zero address, as the regular send does', () => {
      compareHumanizerVisualizations(
        [
          humanizePrivacyPoolsWithdrawal({
            withdrawal: { ...withdrawal, tokenAddress: ZeroAddress, amount: 10n ** 18n },
            expectedFeeAmount: 10n ** 15n
          })
        ],
        [expectedCard(ZeroAddress, 10n ** 18n, 10n ** 15n)]
      )
    })

    test('carries no raw call, so nothing of the single-use sender is shown', () => {
      const call = humanizePrivacyPoolsWithdrawal({ withdrawal, expectedFeeAmount: null })

      expect(call.to).toBeUndefined()
      expect(call.data).toBe('0x')
      expect(call.value).toBe(0n)
      expect(call.warnings).toBeUndefined()
    })
  })
})
