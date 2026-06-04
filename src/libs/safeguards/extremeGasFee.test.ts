import { describe, expect, test } from '@jest/globals'

import {
  EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD,
  EXTREME_GAS_FEE_THRESHOLD_MAINNET_GWEI
} from '../../consts/safeguards/extremeGasFee'
import { getFeeSpeedIdentifier } from '../../controllers/signAccountOp/helper'
import { FeeSpeed } from '../../controllers/signAccountOp/signAccountOp'
import { FeePaymentOption } from '../estimate/interfaces'
import { ISignAccountOpController } from '../../interfaces/signAccountOp'

import {
  getExtremeGasFeeWarningState,
  isExtremeGasFeeUsd,
  isExtremeMainnetGasPrice,
  weiToGwei
} from './extremeGasFee'

const ACCOUNT_ADDR = '0x0000000000000000000000000000000000000001'
const GWEI = 10n ** 9n

const createSelectedOption = (): FeePaymentOption =>
  ({
    paidBy: 'account',
    token: {
      address: '0x0000000000000000000000000000000000000002',
      symbol: 'ETH',
      flags: { onGasTank: false }
    }
  }) as FeePaymentOption

const createSignAccountOpState = ({
  amountUsd = '0',
  gasPrice = 0n
}: {
  amountUsd?: string
  gasPrice?: bigint
}): ISignAccountOpController => {
  const selectedOption = createSelectedOption()
  const identifier = getFeeSpeedIdentifier(selectedOption, ACCOUNT_ADDR)

  return {
    selectedOption,
    selectedFeeSpeed: FeeSpeed.Fast,
    accountOp: { accountAddr: ACCOUNT_ADDR },
    feeSpeeds: {
      [identifier]: [{ type: FeeSpeed.Fast, amountUsd, gasPrice }]
    }
  } as ISignAccountOpController
}

describe('extremeGasFee helpers', () => {
  test('should convert wei to gwei', () => {
    expect(weiToGwei(20n * GWEI)).toBe(20)
    expect(weiToGwei(0n)).toBe(0)
  })

  test('should flag mainnet gas prices above the gwei threshold', () => {
    expect(isExtremeMainnetGasPrice(20n * GWEI)).toBe(false)
    expect(isExtremeMainnetGasPrice(20n * GWEI + 1n)).toBe(true)
    expect(isExtremeMainnetGasPrice(0n)).toBe(false)
    expect(isExtremeMainnetGasPrice(-1n)).toBe(false)
  })

  test('should flag non-mainnet fees above the usd threshold', () => {
    expect(isExtremeGasFeeUsd(EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD)).toBe(false)
    expect(isExtremeGasFeeUsd(EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD + 0.01)).toBe(true)
    expect(isExtremeGasFeeUsd(0)).toBe(false)
    expect(isExtremeGasFeeUsd(-1)).toBe(false)
    expect(isExtremeGasFeeUsd(Number.NaN)).toBe(false)
  })
})

describe('getExtremeGasFeeWarningState on Ethereum', () => {
  test('should return a gwei warning when the gas price exceeds the threshold', () => {
    const result = getExtremeGasFeeWarningState(
      createSignAccountOpState({ amountUsd: '5', gasPrice: 25n * GWEI }),
      1n
    )

    expect(result).toEqual({
      type: 'gwei',
      gasPriceGwei: 25,
      thresholdGwei: EXTREME_GAS_FEE_THRESHOLD_MAINNET_GWEI
    })
  })

  test('should return null when the gas price is within the threshold', () => {
    expect(
      getExtremeGasFeeWarningState(
        createSignAccountOpState({ amountUsd: '500', gasPrice: 15n * GWEI }),
        1n
      )
    ).toBeNull()
  })
})

describe('getExtremeGasFeeWarningState on other networks', () => {
  test('should return a usd warning when the fee exceeds the threshold', () => {
    const result = getExtremeGasFeeWarningState(
      createSignAccountOpState({ amountUsd: '50', gasPrice: 1n * GWEI }),
      137n
    )

    expect(result).toEqual({
      type: 'usd',
      feeUsd: 50,
      thresholdUsd: EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD
    })
  })

  test('should return null when the fee is below the threshold', () => {
    expect(
      getExtremeGasFeeWarningState(createSignAccountOpState({ amountUsd: '5' }), 137n)
    ).toBeNull()
  })
})

describe('getExtremeGasFeeWarningState guards', () => {
  test('should return null when sign state or chain id is missing', () => {
    expect(getExtremeGasFeeWarningState(null, 1n)).toBeNull()
    expect(
      getExtremeGasFeeWarningState(createSignAccountOpState({ gasPrice: 50n * GWEI }), undefined)
    ).toBeNull()
  })
})
