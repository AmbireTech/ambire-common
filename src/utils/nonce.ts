import { Interface } from 'ethers'

import AmbireAccount from '../../contracts/compiled/AmbireAccount.json'
import { IActivityController } from '../interfaces/activity'
import { RPCProvider } from '../interfaces/provider'
import { AccountOp } from '../libs/accountOp/accountOp'
import { AccountOpStatus } from '../libs/accountOp/types'

export async function getRelayerNonce(
  activity: IActivityController,
  op: AccountOp,
  provider: RPCProvider
): Promise<bigint> {
  // find the pending activity with the biggest nonce
  const accountBroadcastedButNotConfirmed = activity.broadcastedButNotConfirmed[op.accountAddr]
  const pendingActivityOps = accountBroadcastedButNotConfirmed.filter(
    (accOp) => accOp.chainId === op.chainId
  )
  const pendingActivityOp = pendingActivityOps.length
    ? pendingActivityOps.reduce((prev, current) => (current.nonce > prev.nonce ? current : prev))
    : null
  if (!pendingActivityOp || (op.nonce && pendingActivityOp.nonce < op.nonce))
    return op.nonce as bigint

  const ambireInterface = new Interface(AmbireAccount.abi)
  const pendingAccountNonce = await provider
    .send('eth_call', [
      {
        to: op.accountAddr,
        data: ambireInterface.encodeFunctionData('nonce')
      },
      'pending'
    ])
    .catch(null)

  if (pendingAccountNonce && BigInt(pendingAccountNonce) > pendingActivityOp.nonce)
    return BigInt(pendingAccountNonce)

  // if there's a failure in the last 5 txns
  // get the failure and check if we have a confirmed txn after
  // if we don't, the latest nonce should be equal to the failed one
  const lastFiveTxns = activity.getLastFive()
  const failure = lastFiveTxns.find((subOp) => subOp.status === AccountOpStatus.Failure)
  if (!failure) return pendingActivityOp.nonce + 1n

  // failed in the last 5, check if we have replayed the nonce
  // and if we haven't, replay it
  const failedNonce = failure.nonce
  const sameNonceBroadcast = lastFiveTxns.filter(
    (subOp) => subOp.nonce === failedNonce && subOp.status !== AccountOpStatus.Failure
  )
  if (!sameNonceBroadcast.length) return failedNonce

  // just go +1
  return pendingActivityOp.nonce + 1n
}
