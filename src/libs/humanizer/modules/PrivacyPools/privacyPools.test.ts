import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { getPrivacyPoolsAsset, getPrivacyPoolsChainConfig } from '../../../../consts/privacyPools'
import { encodePrivacyPoolsDeposit } from '../../../privacyPools/deposit'
import { POOL_RAGEQUIT_INTERFACE } from '../../../privacyPools/ragequit'
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

  describe('taking back a deposit', () => {
    const ETH_POOL = '0xF241d57C6DebAe225c0F2e6eA1529373C9A9C9fB'
    const USDC_POOL = '0xb419c2867aB3CBc78921660cB95150d95A94ce86'

    const encodeRagequit = (amount: bigint) =>
      POOL_RAGEQUIT_INTERFACE.encodeFunctionData('ragequit', [
        {
          pA: [1n, 2n],
          pB: [
            [3n, 4n],
            [5n, 6n]
          ],
          pC: [7n, 8n],
          pubSignals: [11n, 12n, amount, 14n]
        }
      ])

    test('shows it as getting the pool asset back to this account', () => {
      const calls: IrCall[] = [
        { to: ETH_POOL, value: 0n, data: encodeRagequit(10n ** 18n) },
        { to: USDC_POOL, value: 0n, data: encodeRagequit(5_000_000n) }
      ]

      compareHumanizerVisualizations(humanize(calls), [
        [
          getAction('Take back'),
          getToken(ZeroAddress, 10n ** 18n),
          getLabel('from Privacy Pools to this account')
        ],
        [
          getAction('Take back'),
          getToken(USDC, 5_000_000n),
          getLabel('from Privacy Pools to this account')
        ]
      ])
    })

    test('leaves alone a ragequit to an unknown contract, and other calls to a pool', () => {
      const elsewhere = {
        to: '0x000000000000000000000000000000000000dEaD',
        value: 0n,
        data: encodeRagequit(1n)
      }
      const otherPoolCall = { to: ETH_POOL, value: 0n, data: '0x12345678' }
      const [onOtherNetwork] = humanize([{ ...elsewhere, to: ETH_POOL }], { chainId: 137n } as any)

      expect(humanize([elsewhere, otherPoolCall])).toEqual([elsewhere, otherPoolCall])
      expect(onOtherNetwork).toEqual({ ...elsewhere, to: ETH_POOL })
    })
  })

  describe('a withdrawal', () => {
    const withdrawal = {
      recipient: RECIPIENT,
      tokenAddress: USDC,
      amount: 5_000_000n,
      fee: 300_000n,
      noteCount: 2
    }

    const CHAIN_ID = '1'
    const USD_PRICE = 1.0001

    /** A token of the card, with the symbol and decimals of the pool's asset when it is one. */
    const getCardToken = (tokenAddress: string, value: bigint): HumanizerVisualization => {
      const asset = getPrivacyPoolsAsset(BigInt(CHAIN_ID), tokenAddress)

      return {
        ...getToken(tokenAddress, value),
        ...(asset && { tokenInfo: { symbol: asset.symbol, decimals: asset.decimals } })
      }
    }

    /**
     * The clear-signing card a withdrawal of `amount` with a fee cap of `fee` is shown as: what the
     * recipient gets and the fee are the expected ones when the fee is known, otherwise their bounds.
     */
    const expectedCard = (
      tokenAddress: string,
      amount: bigint,
      fee: bigint,
      expectedFeeAmount: bigint | null,
      usdPrice: number | null = USD_PRICE
    ): HumanizerVisualization[] => [
      getErc7730Visualization('Send', [
        {
          type: 'single-value',
          label: 'Amount to Send',
          value: getCardToken(tokenAddress, amount)
        },
        {
          type: 'single-value',
          label: 'Recipient Receives',
          value: getCardToken(tokenAddress, amount - (expectedFeeAmount ?? fee)),
          valuePrefix: expectedFeeAmount === null ? 'at least' : '≈'
        },
        {
          type: 'single-value',
          label: 'Recipient',
          value: { ...getAddressVisualization(RECIPIENT), isLocalLabelOnly: true },
          hasSeparatorBefore: true
        },
        {
          type: 'single-value',
          label: 'Network fee',
          value: {
            ...getCardToken(tokenAddress, expectedFeeAmount ?? fee),
            ...(usdPrice !== null && { usdPrice })
          },
          ...(expectedFeeAmount === null ? { valuePrefix: 'up to' } : {}),
          hasSeparatorBefore: true
        }
      ])
    ]

    const humanize = (
      expectedFeeAmount: bigint | null,
      overrides: { usdPrice?: number | null; tokenAddress?: string; amount?: bigint } = {}
    ) =>
      humanizePrivacyPoolsWithdrawal({
        chainId: CHAIN_ID,
        withdrawal: {
          ...withdrawal,
          ...(overrides.tokenAddress && { tokenAddress: overrides.tokenAddress }),
          ...(overrides.amount && { amount: overrides.amount })
        },
        expectedFeeAmount,
        usdPrice: overrides.usdPrice === undefined ? USD_PRICE : overrides.usdPrice
      })

    test('shows what leaves the account, what the recipient is expected to get, who it is and the fee', () => {
      compareHumanizerVisualizations(
        [humanize(120_000n)],
        [expectedCard(USDC, 5_000_000n, 300_000n, 120_000n)]
      )
    })

    test('shows the whole amount reaching the recipient when the fee is fully refunded', () => {
      compareHumanizerVisualizations([humanize(0n)], [expectedCard(USDC, 5_000_000n, 300_000n, 0n)])
    })

    test('shows the least the recipient gets and the most the fee can be when it was not simulated', () => {
      compareHumanizerVisualizations(
        [humanize(null)],
        [expectedCard(USDC, 5_000_000n, 300_000n, null)]
      )
    })

    test('never marks a simulated amount as a bound, nor a bound as an estimate', () => {
      const [simulated, notSimulated] = [120_000n, null].map((expectedFeeAmount) => {
        const card = humanize(expectedFeeAmount).fullVisualization?.[0]
        if (card?.type !== 'erc7730') throw new Error('Expected a clear-signing card')

        return card.fields.map((row) => (row.type === 'single-value' ? row.valuePrefix : undefined))
      })

      expect(simulated).toEqual([undefined, '≈', undefined, undefined])
      expect(notSimulated).toEqual([undefined, 'at least', undefined, 'up to'])
    })

    test('prices only the fee, and leaves its price out when unknown', () => {
      const getUsdPrices = (usdPrice: number | null) => {
        const card = humanize(120_000n, { usdPrice }).fullVisualization?.[0]
        if (card?.type !== 'erc7730') throw new Error('Expected a clear-signing card')

        return card.fields.map((row) =>
          row.type === 'single-value' && row.value.type === 'token' ? row.value.usdPrice : undefined
        )
      }

      expect(getUsdPrices(USD_PRICE)).toEqual([undefined, undefined, undefined, USD_PRICE])
      expect(getUsdPrices(null)).toEqual([undefined, undefined, undefined, undefined])
    })

    test("gives the native asset's symbol and decimals, so the card needs no lookup", () => {
      const card = humanize(10n ** 15n, { tokenAddress: ZeroAddress, amount: 10n ** 18n })
        .fullVisualization?.[0]
      if (card?.type !== 'erc7730') throw new Error('Expected a clear-signing card')
      const [amountRow] = card.fields
      if (amountRow?.type !== 'single-value' || amountRow.value.type !== 'token')
        throw new Error('Expected a token row')

      expect(amountRow.value.tokenInfo).toEqual({ symbol: 'ETH', decimals: 18 })
    })

    test('gives no symbol for a token that is not a pool asset, so the UI still looks it up', () => {
      const NOT_A_POOL_ASSET = '0x0000000000000000000000000000000000000001'
      const card = humanize(120_000n, { tokenAddress: NOT_A_POOL_ASSET }).fullVisualization?.[0]
      if (card?.type !== 'erc7730') throw new Error('Expected a clear-signing card')
      const [amountRow] = card.fields
      if (amountRow?.type !== 'single-value' || amountRow.value.type !== 'token')
        throw new Error('Expected a token row')

      expect(amountRow.value.tokenInfo).toBeUndefined()
    })

    test('describes native ETH by the zero address, as the regular send does', () => {
      compareHumanizerVisualizations(
        [humanize(10n ** 15n, { tokenAddress: ZeroAddress, amount: 10n ** 18n })],
        [expectedCard(ZeroAddress, 10n ** 18n, 300_000n, 10n ** 15n)]
      )
    })

    test('carries no raw call, so nothing of the single-use sender is shown', () => {
      const call = humanize(null)

      expect(call.to).toBeUndefined()
      expect(call.data).toBe('0x')
      expect(call.value).toBe(0n)
      expect(call.warnings).toBeUndefined()
    })
  })
})
