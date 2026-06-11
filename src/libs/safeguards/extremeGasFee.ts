import {
  EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD,
  EXTREME_GAS_FEE_THRESHOLD_MAINNET_GWEI
} from '../../consts/safeguards/extremeGasFee'
import { getFeeSpeedIdentifier } from '../../controllers/signAccountOp/helper'
import { FeeSpeed } from '../../controllers/signAccountOp/signAccountOp'
import { ISignAccountOpController } from '../../interfaces/signAccountOp'

const ETHEREUM_CHAIN_ID = 1n
const WEI_PER_GWEI = 10n ** 9n

// On Ethereum the gas price (in gwei) is the meaningful signal for an
// "extreme" fee, while on the other (cheaper) networks we still rely on the
// absolute USD cost.
export type ExtremeGasFeeWarningState =
  | { type: 'gwei'; gasPriceGwei: number; thresholdGwei: number }
  | { type: 'usd'; feeUsd: number; thresholdUsd: number }

export function weiToGwei(weiValue: bigint): number {
  return Number(weiValue) / Number(WEI_PER_GWEI)
}

export function isExtremeMainnetGasPrice(gasPriceWei: bigint): boolean {
  if (gasPriceWei <= 0n) return false

  return weiToGwei(gasPriceWei) > EXTREME_GAS_FEE_THRESHOLD_MAINNET_GWEI
}

export function isExtremeGasFeeUsd(feeUsd: number): boolean {
  if (!Number.isFinite(feeUsd) || feeUsd <= 0) return false

  return feeUsd > EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD
}

// Ambire batches multiple calls into a single AccountOp, so the total fee
// scales with the number of operations. Comparing the per-operation cost (not
// the total) to the threshold avoids false positives on legitimately large
// batches while still flagging a single operation that is unusually expensive.
export function getPerOperationFeeUsd(feeUsd: number, callsCount: number): number {
  const operationsCount = Math.max(1, callsCount)

  return feeUsd / operationsCount
}

export function getExtremeGasFeeWarningState(
  signAccountOpState: ISignAccountOpController | null,
  networkChainId: bigint | undefined
): ExtremeGasFeeWarningState | null {
  if (!signAccountOpState?.selectedOption || !networkChainId) return null

  const identifier = getFeeSpeedIdentifier(
    signAccountOpState.selectedOption,
    signAccountOpState.accountOp.accountAddr
  )
  const selectedFeeSpeed =
    signAccountOpState.feeSpeeds[identifier]?.find(
      (speed) => speed.type === signAccountOpState.selectedFeeSpeed
    ) || signAccountOpState.feeSpeeds[identifier]?.find((speed) => speed.type === FeeSpeed.Fast)

  if (!selectedFeeSpeed) return null

  if (networkChainId === ETHEREUM_CHAIN_ID) {
    if (!isExtremeMainnetGasPrice(selectedFeeSpeed.gasPrice)) return null

    return {
      type: 'gwei',
      gasPriceGwei: weiToGwei(selectedFeeSpeed.gasPrice),
      thresholdGwei: EXTREME_GAS_FEE_THRESHOLD_MAINNET_GWEI
    }
  }

  if (!selectedFeeSpeed.amountUsd) return null

  const feeUsd = Number(selectedFeeSpeed.amountUsd)
  const callsCount = signAccountOpState.accountOp.calls?.length ?? 0
  const perOperationFeeUsd = getPerOperationFeeUsd(feeUsd, callsCount)
  if (!isExtremeGasFeeUsd(perOperationFeeUsd)) return null

  return {
    type: 'usd',
    feeUsd,
    thresholdUsd: EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD
  }
}
