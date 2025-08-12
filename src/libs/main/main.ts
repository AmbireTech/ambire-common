import { AccountOpAction, Action } from '../../controllers/actions/actions'
import { Account } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { isSmartAccount } from '../account/account'
import { AccountOp } from '../accountOp/accountOp'

export const ACCOUNT_SWITCH_USER_REQUEST = 'ACCOUNT_SWITCH_USER_REQUEST'

export const getAccountOpsForSimulation = (
  account: Account,
  visibleActionsQueue: Action[],
  networks: Network[]
): { [key: string]: AccountOp[] } | undefined => {
  const isSmart = isSmartAccount(account)
  const accountOps = (
    visibleActionsQueue.filter((a) => a.type === 'accountOp') as AccountOpAction[]
  )
    .map((a) => a.accountOp)
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
