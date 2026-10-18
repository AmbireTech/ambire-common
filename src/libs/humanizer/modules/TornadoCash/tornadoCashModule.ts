import { TORNADO_CASH_CHAIN_ID } from '../../../../consts/tornadoCash'
import { AccountOp } from '../../../accountOp/accountOp'
import { readTornadoCashDeposit } from '../../../tornadoCash/deposit'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getLabel, getToken } from '../../utils'

/**
 * Shows a deposit into a Tornado Cash pool as a send to a Tornado Cash account. The call ties it to
 * the account only by a commitment, so no account is named. Each note is its own call, of the
 * pool's fixed amount.
 */
export const tornadoCashModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  if (accountOp.chainId !== TORNADO_CASH_CHAIN_ID) return call

  const deposit = readTornadoCashDeposit({ to: call.to, data: call.data, value: call.value })
  if (!deposit) return call

  return {
    ...call,
    fullVisualization: [
      getAction('Send'),
      getToken(deposit.pool.assetAddress, deposit.pool.denomination),
      getLabel('to a Tornado Cash account')
    ]
  }
}
