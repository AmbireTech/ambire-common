import { toBeHex } from 'ethers'

import type { Hex } from '../../interfaces/hex'
import type { GasSpeeds } from '../../services/bundlers/types'
import type { GasFeePayment } from '../accountOp/accountOp'

// Kept apart from gasPrice.ts, which pulls in contracts and RPC clients,
// so the UI can import these to validate the fees the user sets manually

/** The fees of the pending transaction that is being replaced (sped up). */
type ReplacedFees = Pick<GasFeePayment, 'gasPrice' | 'maxPriorityFeePerGas'>

// Nodes reject a transaction that replaces a pending one (same nonce) unless both its max fee
// and its tip are higher than the pending one's by a minimum percentage (10% on geth based
// nodes, 12.5% on some others). Using 12.5% satisfies all of them
const REPLACEMENT_FEE_INCREASE_BPS = 1250n

/**
 * The lowest fees a transaction must pay to replace (speed up) a pending one
 * with the same nonce. Rounded up so the result never ends up just below the threshold.
 *
 * @param replacedFees - the fees of the pending transaction that is being replaced
 */
export function getMinReplacementFees(replacedFees: ReplacedFees): {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
} {
  const increaseByReplacementBps = (value: bigint) =>
    (value * (10000n + REPLACEMENT_FEE_INCREASE_BPS) + 9999n) / 10000n

  return {
    maxFeePerGas: increaseByReplacementBps(replacedFees.gasPrice),
    maxPriorityFeePerGas: increaseByReplacementBps(replacedFees.maxPriorityFeePerGas ?? 0n)
  }
}

/**
 * Raises each speed's max fee and tip (separately) to at least the minimum needed to
 * replace (speed up) a pending transaction. Speeds that are already above it are kept as is.
 *
 * @param gasPrices - the current gas price estimation
 * @param replacedFees - the fees of the pending transaction that is being replaced
 */
export function getSpeedUpGasPrices(gasPrices: GasSpeeds, replacedFees: ReplacedFees): GasSpeeds {
  const minFees = getMinReplacementFees(replacedFees)
  const atLeast = (value: bigint | string | number, min: bigint) => {
    const bigValue = BigInt(value)
    return toBeHex(bigValue > min ? bigValue : min) as Hex
  }
  const raiseToMin = (gas: GasSpeeds[keyof GasSpeeds]) => ({
    maxFeePerGas: atLeast(gas.maxFeePerGas, minFees.maxFeePerGas),
    maxPriorityFeePerGas: atLeast(gas.maxPriorityFeePerGas, minFees.maxPriorityFeePerGas)
  })

  return {
    slow: raiseToMin(gasPrices.slow),
    medium: raiseToMin(gasPrices.medium),
    fast: raiseToMin(gasPrices.fast),
    ape: raiseToMin(gasPrices.ape)
  }
}
