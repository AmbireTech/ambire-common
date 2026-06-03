import {
  EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD,
  EXTREME_GAS_FEE_THRESHOLD_MAINNET_USD
} from '../../consts/safeguards/extremeGasFee'
import { getFeeSpeedIdentifier } from '../../controllers/signAccountOp/helper'
import { FeeSpeed } from '../../controllers/signAccountOp/signAccountOp'
import { ISignAccountOpController } from '../../interfaces/signAccountOp'

export type ExtremeGasFeeWarningState = {
  feeUsd: number
  thresholdUsd: number
}

export function getExtremeGasFeeThresholdUsd(chainId: bigint): number {
  return chainId === 1n
    ? EXTREME_GAS_FEE_THRESHOLD_MAINNET_USD
    : EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD
}

export function isExtremeGasFee(feeUsd: number, chainId: bigint): boolean {
  if (!Number.isFinite(feeUsd) || feeUsd <= 0) return false

  return feeUsd > getExtremeGasFeeThresholdUsd(chainId)
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

  if (!selectedFeeSpeed?.amountUsd) return null

  const feeUsd = Number(selectedFeeSpeed.amountUsd)
  if (!isExtremeGasFee(feeUsd, networkChainId)) return null

  return {
    feeUsd,
    thresholdUsd: getExtremeGasFeeThresholdUsd(networkChainId)
  }
}
