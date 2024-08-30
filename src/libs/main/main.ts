import { JsonRpcProvider, Provider } from 'ethers'

import { AccountOpAction, Action } from '../../controllers/actions/actions'
import { Account, AccountId, AccountOnchainState } from '../../interfaces/account'
import { Network, NetworkId } from '../../interfaces/network'
import { Calls, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import { Bundler } from '../../services/bundlers/bundler'
import generateSpoofSig from '../../utils/generateSpoofSig'
import { isSmartAccount } from '../account/account'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { getAccountOpsByNetwork } from '../actions/actions'
import { GasRecommendation, getGasPriceRecommendations } from '../gasPrice/gasPrice'
import { adjustEntryPointAuthorization } from '../signMessage/signMessage'
import { isErc4337Broadcast } from '../userOperation/userOperation'

export const batchCallsFromUserRequests = ({
  accountAddr,
  networkId,
  userRequests
}: {
  accountAddr: AccountId
  networkId: NetworkId
  userRequests: UserRequest[]
}): Call[] => {
  return (userRequests.filter((r) => r.action.kind === 'calls') as SignUserRequest[]).reduce(
    (uCalls: Call[], req) => {
      if (req.meta.networkId === networkId && req.meta.accountAddr === accountAddr) {
        const { calls } = req.action as Calls
        calls.forEach((call) => uCalls.push({ ...call, fromUserRequestId: req.id }))
      }
      return uCalls
    },
    []
  )
}

export const makeSmartAccountOpAction = ({
  account,
  networkId,
  nonce,
  actionsQueue,
  userRequests,
  entryPointAuthorizationSignature
}: {
  account: Account
  networkId: string
  nonce: bigint | null
  actionsQueue: Action[]
  userRequests: UserRequest[]
  entryPointAuthorizationSignature?: string
}): AccountOpAction => {
  const accountOpAction = actionsQueue.find(
    (a) => a.type === 'accountOp' && a.id === `${account.addr}-${networkId}`
  ) as AccountOpAction | undefined

  if (accountOpAction) {
    accountOpAction.accountOp.calls = batchCallsFromUserRequests({
      accountAddr: account.addr,
      networkId,
      userRequests
    })
    // the nonce might have changed during estimation because of
    // a nonce discrepancy issue. This makes sure we're with the
    // latest nonce should the user decide to batch
    accountOpAction.accountOp.nonce = nonce
    return accountOpAction
  }

  const accountOp: AccountOpAction['accountOp'] = {
    accountAddr: account.addr,
    networkId,
    signingKeyAddr: null,
    signingKeyType: null,
    gasLimit: null,
    gasFeePayment: null,
    nonce,
    signature: account.associatedKeys[0] ? generateSpoofSig(account.associatedKeys[0]) : null,
    accountOpToExecuteBefore: null, // @TODO from pending recoveries
    calls: batchCallsFromUserRequests({
      accountAddr: account.addr,
      networkId,
      userRequests
    })
  }

  if (entryPointAuthorizationSignature) {
    accountOp.meta = {
      entryPointAuthorization: adjustEntryPointAuthorization(entryPointAuthorizationSignature)
    }
  }

  return {
    id: `${account.addr}-${networkId}`, // SA accountOpAction id
    type: 'accountOp',
    accountOp
  }
}

export const makeBasicAccountOpAction = ({
  account,
  networkId,
  nonce,
  userRequest
}: {
  account: Account
  networkId: string
  nonce: bigint | null
  userRequest: UserRequest
}): AccountOpAction => {
  const { calls } = userRequest.action as Calls
  const accountOp = {
    accountAddr: account.addr,
    networkId,
    signingKeyAddr: null,
    signingKeyType: null,
    gasLimit: null,
    gasFeePayment: null,
    nonce,
    signature: account.associatedKeys[0] ? generateSpoofSig(account.associatedKeys[0]) : null,
    accountOpToExecuteBefore: null, // @TODO from pending recoveries
    calls: calls.map((call) => ({ ...call, fromUserRequestId: userRequest.id }))
  }

  return {
    // BA accountOpAction id same as the userRequest's id because for each call we have an action
    id: userRequest.id,
    type: 'accountOp',
    accountOp
  }
}

export const getAccountOpsForSimulation = (
  account: Account,
  visibleActionsQueue: Action[],
  network?: Network,
  op?: AccountOp | null
): {
  [key: string]: AccountOp[]
} => {
  const isSmart = isSmartAccount(account)

  // if there's an op and the account is either smart or the network supports
  // state override, we pass it along. We do not support simulation for
  // EOAs on networks without state override (but it works for SA)
  if (op && (isSmart || (network && !network.rpcNoStateOverride))) return { [op.networkId]: [op] }

  if (isSmart) return getAccountOpsByNetwork(account.addr, visibleActionsQueue) || {}

  return {}
}

export async function updateGasPrice(
  network: Network,
  accountState: AccountOnchainState,
  provider: JsonRpcProvider | Provider,
  emitError: Function
): Promise<{
  gasPrice?: GasRecommendation[]
  blockGasLimit?: bigint
  bundlerGas?: {
    slow: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    medium: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    fast: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    ape: { maxFeePerGas: string; maxPriorityFeePerGas: string }
  }
}> {
  const is4337 = isErc4337Broadcast(network, accountState)

  const bundlerFetch = async () => {
    if (!is4337) return undefined
    return Bundler.fetchGasPrices(network).catch((e) => {
      emitError({
        level: 'silent',
        message: "Failed to fetch the bundler's gas price",
        error: e
      })
      return undefined
    })
  }

  const [gasPriceData, bundlerGas] = await Promise.all([
    getGasPriceRecommendations(provider, network).catch((e) => {
      emitError({
        level: 'major',
        message: `Unable to get gas price for ${network.id}`,
        error: new Error(`Failed to fetch gas price: ${e?.message}`)
      })
      return undefined
    }),
    bundlerFetch()
  ])

  return {
    gasPrice: gasPriceData?.gasPrice,
    blockGasLimit: gasPriceData?.blockGasLimit,
    bundlerGas
  }
}
