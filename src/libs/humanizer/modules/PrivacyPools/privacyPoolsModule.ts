import {
  fromPrivacyPoolsAssetAddress,
  getPrivacyPoolsChainConfig
} from '../../../../consts/privacyPools'
import { AccountOp } from '../../../accountOp/accountOp'
import { readPrivacyPoolsDeposit } from '../../../privacyPools/deposit'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getLabel, getToken } from '../../utils'

/**
 * Shows a Privacy Pools deposit as a send to a Privacy Pools account. The call ties it to the
 * account only by a precommitment, so no account is named.
 */
export const privacyPoolsModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  const config = accountOp.chainId ? getPrivacyPoolsChainConfig(accountOp.chainId) : undefined
  if (!config || call.to?.toLowerCase() !== config.entrypointAddress.toLowerCase()) return call

  const deposit = readPrivacyPoolsDeposit({ data: call.data, value: call.value })
  if (!deposit) return call

  return {
    ...call,
    fullVisualization: [
      getAction('Send'),
      getToken(fromPrivacyPoolsAssetAddress(deposit.assetAddress), deposit.amount),
      getLabel('to a Privacy Pools account')
    ]
  }
}
