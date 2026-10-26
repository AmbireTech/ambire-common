import { toBeHex } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { Hex } from '../../../interfaces/hex'
import { GasSpeeds } from '../../../services/bundlers/types'
import { gasPriceToBundlerFormat } from '../gasPrice'
import { getFeeIncreasePercent, getSpeedUpGasPrices } from '../speedUp'

const gwei = 1000000000n

const toGas = (maxFeePerGas: bigint, maxPriorityFeePerGas: bigint) => ({
  maxFeePerGas: toBeHex(maxFeePerGas) as Hex,
  maxPriorityFeePerGas: toBeHex(maxPriorityFeePerGas) as Hex
})

const toBigIntSpeeds = (gasPrices: GasSpeeds) =>
  Object.fromEntries(
    Object.entries(gasPrices).map(([speed, gas]) => [
      speed,
      {
        maxFeePerGas: BigInt(gas.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(gas.maxPriorityFeePerGas)
      }
    ])
  )

// 12.5% above 100 gwei max fee and 2 gwei tip
const replacedFees = { gasPrice: 100n * gwei, maxPriorityFeePerGas: 2n * gwei }
const minMaxFee = 112500000000n
const minTip = 2250000000n

describe('getSpeedUpGasPrices', () => {
  test('should use the estimation as is when every speed is above the minimum', () => {
    const gasPrices: GasSpeeds = {
      slow: toGas(120n * gwei, 3n * gwei),
      medium: toGas(130n * gwei, 4n * gwei),
      fast: toGas(140n * gwei, 5n * gwei),
      ape: toGas(150n * gwei, 6n * gwei)
    }

    expect(toBigIntSpeeds(getSpeedUpGasPrices(gasPrices, replacedFees))).toEqual(
      toBigIntSpeeds(gasPrices)
    )
  })

  test('should raise only the speeds below the minimum to it', () => {
    const gasPrices: GasSpeeds = {
      slow: toGas(90n * gwei, 1n * gwei),
      medium: toGas(130n * gwei, 4n * gwei),
      fast: toGas(140n * gwei, 5n * gwei),
      ape: toGas(150n * gwei, 6n * gwei)
    }

    const result = toBigIntSpeeds(getSpeedUpGasPrices(gasPrices, replacedFees))

    expect(result.slow).toEqual({ maxFeePerGas: minMaxFee, maxPriorityFeePerGas: minTip })
    expect(result.medium).toEqual({ maxFeePerGas: 130n * gwei, maxPriorityFeePerGas: 4n * gwei })
    expect(result.fast).toEqual({ maxFeePerGas: 140n * gwei, maxPriorityFeePerGas: 5n * gwei })
    expect(result.ape).toEqual({ maxFeePerGas: 150n * gwei, maxPriorityFeePerGas: 6n * gwei })
  })

  test('should raise the max fee and the tip separately', () => {
    // max fee is above the minimum, but the tip is not, and vice versa
    const gasPrices: GasSpeeds = {
      slow: toGas(200n * gwei, 1n * gwei),
      medium: toGas(100n * gwei, 10n * gwei),
      fast: toGas(200n * gwei, 10n * gwei),
      ape: toGas(200n * gwei, 10n * gwei)
    }

    const result = toBigIntSpeeds(getSpeedUpGasPrices(gasPrices, replacedFees))

    expect(result.slow).toEqual({ maxFeePerGas: 200n * gwei, maxPriorityFeePerGas: minTip })
    expect(result.medium).toEqual({ maxFeePerGas: minMaxFee, maxPriorityFeePerGas: 10n * gwei })
  })

  test('should never return fees below the minimum, even if the estimation is far lower', () => {
    const gasPrices: GasSpeeds = {
      slow: toGas(1n, 0n),
      medium: toGas(1n, 0n),
      fast: toGas(1n, 0n),
      ape: toGas(1n, 0n)
    }

    const result = toBigIntSpeeds(getSpeedUpGasPrices(gasPrices, replacedFees))

    Object.values(result).forEach((gas) => {
      expect(gas.maxFeePerGas).toBe(minMaxFee)
      expect(gas.maxPriorityFeePerGas).toBe(minTip)
    })
  })

  test('should keep a speed that is exactly at the minimum as is', () => {
    const atMin = toGas(minMaxFee, minTip)
    const gasPrices: GasSpeeds = { slow: atMin, medium: atMin, fast: atMin, ape: atMin }

    const result = toBigIntSpeeds(getSpeedUpGasPrices(gasPrices, replacedFees))

    expect(result.slow).toEqual({ maxFeePerGas: minMaxFee, maxPriorityFeePerGas: minTip })
  })

  test('should round the minimum up so it never falls just below 12.5%', () => {
    // 7 * 1.125 = 7.875 and 3 * 1.125 = 3.375, both round up
    const gasPrices: GasSpeeds = {
      slow: toGas(0n, 0n),
      medium: toGas(0n, 0n),
      fast: toGas(0n, 0n),
      ape: toGas(0n, 0n)
    }

    const result = toBigIntSpeeds(
      getSpeedUpGasPrices(gasPrices, { gasPrice: 7n, maxPriorityFeePerGas: 3n })
    )

    expect(result.slow).toEqual({ maxFeePerGas: 8n, maxPriorityFeePerGas: 4n })
  })

  test('should raise only the gas price on networks without tips', () => {
    // non-1559 networks have no tip
    const gasPrices = gasPriceToBundlerFormat(
      ['slow', 'medium', 'fast', 'ape'].map((name) => ({ name, gasPrice: 90n * gwei }))
    )

    const result = toBigIntSpeeds(getSpeedUpGasPrices(gasPrices, { gasPrice: 100n * gwei }))

    expect(result.slow).toEqual({ maxFeePerGas: minMaxFee, maxPriorityFeePerGas: 0n })
  })
})

describe('getFeeIncreasePercent', () => {
  test('returns the increase in whole percent', () => {
    expect(getFeeIncreasePercent(100n, 125n)).toBe(25)
    expect(getFeeIncreasePercent(100n, 300n)).toBe(200)
  })

  test('rounds to the nearest whole percent', () => {
    // 91 / 35 = 260%
    expect(getFeeIncreasePercent(35n, 126n)).toBe(260)
    // 1 / 3 = 33.33%
    expect(getFeeIncreasePercent(3n, 4n)).toBe(33)
  })

  test('is null when the new fee is not higher', () => {
    expect(getFeeIncreasePercent(100n, 100n)).toBeNull()
    expect(getFeeIncreasePercent(100n, 90n)).toBeNull()
  })

  test('is null when the replaced fee is 0, as there is nothing to compare to', () => {
    expect(getFeeIncreasePercent(0n, 100n)).toBeNull()
  })
})
