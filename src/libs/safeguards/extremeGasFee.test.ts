import { describe, expect, test } from '@jest/globals'

import { getFeeSpeedIdentifier } from '../../controllers/signAccountOp/helper'
import { FeeSpeed } from '../../controllers/signAccountOp/signAccountOp'
import {
  EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD,
  EXTREME_GAS_FEE_THRESHOLD_MAINNET_USD,
  getExtremeGasFeeThresholdUsd,
  isExtremeGasFee
} from '../../consts/safeguards/extremeGasFee'
import { FeePaymentOption } from '../estimate/interfaces'
import { ISignAccountOpController } from '../../interfaces/signAccountOp'

import { getExtremeGasFeeWarningState } from './extremeGasFee'

const ACCOUNT_ADDR = '0x0000000000000000000000000000000000000001'

const createSelectedOption = (): FeePaymentOption =>
  ({
    paidBy: 'account',
    token: {
      address: '0x0000000000000000000000000000000000000002',
      symbol: 'ETH',
      flags: { onGasTank: false }
    }
  }) as FeePaymentOption

const createSignAccountOpState = (amountUsd: string): ISignAccountOpController => {
  const selectedOption = createSelectedOption()
  const identifier = getFeeSpeedIdentifier(selectedOption, ACCOUNT_ADDR)

  return {
    selectedOption,
    selectedFeeSpeed: FeeSpeed.Fast,
    accountOp: { accountAddr: ACCOUNT_ADDR },
    feeSpeeds: {
      [identifier]: [{ type: FeeSpeed.Fast, amountUsd }]
    }
  } as ISignAccountOpController
}

describe('extremeGasFee consts', () => {
  test('should use mainnet threshold for chain id 1', () => {
    expect(getExtremeGasFeeThresholdUsd(1n)).toBe(EXTREME_GAS_FEE_THRESHOLD_MAINNET_USD)
    expect(isExtremeGasFee(100, 1n)).toBe(false)
    expect(isExtremeGasFee(100.01, 1n)).toBe(true)
  })

  test('should use default threshold for non-mainnet chains', () => {
    expect(getExtremeGasFeeThresholdUsd(137n)).toBe(EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD)
    expect(isExtremeGasFee(10, 137n)).toBe(false)
    expect(isExtremeGasFee(10.01, 137n)).toBe(true)
  })

  test('should not flag invalid or non-positive fee amounts', () => {
    expect(isExtremeGasFee(0, 1n)).toBe(false)
    expect(isExtremeGasFee(-1, 1n)).toBe(false)
    expect(isExtremeGasFee(Number.NaN, 1n)).toBe(false)
  })
})

describe('getExtremeGasFeeWarningState', () => {
  test('should return null when sign state or chain id is missing', () => {
    expect(getExtremeGasFeeWarningState(null, 1n)).toBeNull()
    expect(getExtremeGasFeeWarningState(createSignAccountOpState('150'), undefined)).toBeNull()
  })

  test('should return warning state when fee exceeds threshold', () => {
    const result = getExtremeGasFeeWarningState(createSignAccountOpState('150'), 1n)

    expect(result).toEqual({
      feeUsd: 150,
      thresholdUsd: EXTREME_GAS_FEE_THRESHOLD_MAINNET_USD
    })
  })

  test('should return null when fee is below threshold', () => {
    expect(getExtremeGasFeeWarningState(createSignAccountOpState('50'), 1n)).toBeNull()
  })
})
