import { getFeeSpeedIdentifier } from '../../controllers/signAccountOp/helper'
import { FeeSpeed } from '../../controllers/signAccountOp/signAccountOp'
import {
  getExtremeGasFeeThresholdUsd,
  isExtremeGasFee
} from '../../consts/safeguards/extremeGasFee'
import { ISignAccountOpController } from '../../interfaces/signAccountOp'

export type ExtremeGasFeeWarningState = {
  feeUsd: number
  thresholdUsd: number
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
