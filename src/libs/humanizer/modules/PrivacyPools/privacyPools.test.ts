import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { getPrivacyPoolsChainConfig } from '../../../../consts/privacyPools'
import { encodePrivacyPoolsDeposit } from '../../../privacyPools/deposit'
import { HumanizerVisualization, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getLabel, getToken } from '../../utils'
import { privacyPoolsModule } from './privacyPoolsModule'

const ENTRYPOINT = getPrivacyPoolsChainConfig(1n)!.entrypointAddress
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
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
})
