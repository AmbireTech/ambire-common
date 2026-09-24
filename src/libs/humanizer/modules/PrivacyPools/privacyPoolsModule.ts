import {
  fromPrivacyPoolsAssetAddress,
  getPrivacyPoolsChainConfig
} from '../../../../consts/privacyPools'
import { AccountOp } from '../../../accountOp/accountOp'
import { readPrivacyPoolsDeposit } from '../../../privacyPools/deposit'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getLabel, getToken } from '../../utils'

/**
 * Describes a deposit into Privacy Pools the way the wallet presents it: a transfer to a Privacy
 * Pools account. Which account is not in the call - the deposit is only tied to it by a
 * precommitment - so none is named.
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
