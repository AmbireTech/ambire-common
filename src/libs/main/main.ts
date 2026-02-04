import { Account } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { UserRequest } from '../../interfaces/userRequest'
import { isSmartAccount } from '../account/account'
import { AccountOp } from '../accountOp/accountOp'
import { getSameNonceRequests } from '../safe/safe'

export const ACCOUNT_SWITCH_USER_REQUEST = 'ACCOUNT_SWITCH_USER_REQUEST'

export const getAccountOpsForSimulation = (
  account: Account,
  visibleUserRequests: UserRequest[],
  networks: Network[]
): { [key: string]: AccountOp[] } | undefined => {
  let callRequests = visibleUserRequests.filter((r) => r.kind === 'calls')

  // filter out the safe requests with conflicting nonces (same nonce)
  // from the simulation as the user will have to choose and broadcast only one
  if (!!account.safeCreation) {
    const sameNonceRequestsIds = Object.values(getSameNonceRequests(callRequests))
      .filter((grouped) => grouped.length > 1) // length of 1 means no conflict
      .flat()
      .map((r) => r.id)
    callRequests = callRequests.filter((r) => !sameNonceRequestsIds.includes(r.id))
  }

  const isSmart = isSmartAccount(account)
  const accountOps = callRequests
    .map((a) => a.signAccountOp.accountOp)
    .filter((op) => {
      if (op.accountAddr !== account.addr) return false

      const networkData = networks.find((n) => n.chainId === op.chainId)

      // We cannot simulate if the account isn't smart and the network's RPC doesn't support
      // state override
      return isSmart || (networkData && !networkData.rpcNoStateOverride)
    })

  if (!accountOps.length) return undefined

  return accountOps.reduce((acc: any, accountOp) => {
    const { chainId } = accountOp

    if (!acc[chainId.toString()]) acc[chainId.toString()] = []

    acc[chainId.toString()].push(accountOp)
    return acc
  }, {})
}
