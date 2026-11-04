import { parseUnits, toBeHex } from 'ethers'

import { afterEach, beforeEach, jest } from '@jest/globals'

import { Hex } from '../../src/interfaces/hex'
import { BundlerEstimateResult } from '../../src/libs/estimate/interfaces'
import { Bundler } from '../../src/services/bundlers/bundler'
import { Candide } from '../../src/services/bundlers/candide'
import { Gelato } from '../../src/services/bundlers/gelato'
import { GasSpeeds } from '../../src/services/bundlers/types'

const gwei = (amount: string) => toBeHex(parseUnits(amount, 'gwei')) as Hex

/** The gas prices every bundler returns while `mockBundlerRequests` is active */
export const MOCK_BUNDLER_GAS_PRICES: GasSpeeds = {
  slow: { maxFeePerGas: gwei('1'), maxPriorityFeePerGas: gwei('0.1') },
  medium: { maxFeePerGas: gwei('1.5'), maxPriorityFeePerGas: gwei('0.15') },
  fast: { maxFeePerGas: gwei('2'), maxPriorityFeePerGas: gwei('0.2') },
  ape: { maxFeePerGas: gwei('3'), maxPriorityFeePerGas: gwei('0.3') }
}

/** The user operation gas limits every bundler returns while `mockBundlerRequests` is active */
export const MOCK_BUNDLER_ESTIMATE: BundlerEstimateResult = {
  preVerificationGas: toBeHex(60000n) as Hex,
  verificationGasLimit: toBeHex(150000n) as Hex,
  callGasLimit: toBeHex(100000n) as Hex,
  paymasterVerificationGasLimit: toBeHex(0n) as Hex,
  paymasterPostOpGasLimit: toBeHex(0n) as Hex
}

/**
 * Replaces the bundler requests (gas prices, user operation estimation and the network
 * support check) with fixed responses, so tests that only pass through the bundler code
 * paths don't call the real bundlers. Only `bundler.test.ts` and `estimateBundler.test.ts`,
 * which test the bundlers themselves, and tests that assert on real bundler results
 * should reach the network.
 *
 * The spies are on the prototypes, so they cover every bundler instance, including the
 * ones a `BundlerSwitcher` creates internally. `jest.restoreAllMocks()` undoes them.
 */
export function mockBundlerRequests() {
  const fetchGasPrices = jest
    .spyOn(Bundler.prototype, 'fetchGasPrices')
    .mockResolvedValue(MOCK_BUNDLER_GAS_PRICES)
  // Candide and Gelato override estimate, so spying on the base class alone misses them
  const estimate = [
    jest.spyOn(Bundler.prototype, 'estimate').mockResolvedValue(MOCK_BUNDLER_ESTIMATE),
    jest.spyOn(Candide.prototype, 'estimate').mockResolvedValue(MOCK_BUNDLER_ESTIMATE),
    jest.spyOn(Gelato.prototype, 'estimate').mockResolvedValue(MOCK_BUNDLER_ESTIMATE)
  ]
  const isNetworkSupported = jest.spyOn(Bundler, 'isNetworkSupported').mockResolvedValue(true)

  const restore = () => {
    fetchGasPrices.mockRestore()
    estimate.forEach((spy) => spy.mockRestore())
    isNetworkSupported.mockRestore()
  }

  return { fetchGasPrices, estimate, isNetworkSupported, restore }
}

/**
 * Applies `mockBundlerRequests` before every test of the file or describe it's called in.
 * Re-applying it each time keeps it in place in describes that call
 * `jest.restoreAllMocks()` in their own `afterEach`.
 */
export function mockBundlerRequestsBeforeEach() {
  let restoreBundlerRequests: () => void

  beforeEach(() => {
    restoreBundlerRequests = mockBundlerRequests().restore
  })

  afterEach(() => {
    restoreBundlerRequests()
  })
}
