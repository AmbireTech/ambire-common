// this is the old code used to do ERC-4337 estimation through
// Estimation4337.sol and the EntryPoint.sol
// I'm leaving it in case a usecase for it reappears.
// It's not tested so don't expect it to work off the bat

import { Interface, JsonRpcProvider } from 'ethers'
import { Network } from 'interfaces/network'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import Estimation4337 from '../../../contracts/compiled/Estimation4337.json'
import { DEPLOYLESS_SIMULATION_FROM, ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Account } from '../../interfaces/account'
import { getSpoof } from '../account/account'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { fromDescriptor } from '../deployless/deployless'
import { UserOperation } from '../userOperation/types'
import { getOneTimeNonce, shouldUseOneTimeNonce } from '../userOperation/userOperation'

export function estimateViaEntryPoint(
  userOp: UserOperation,
  account: Account,
  op: AccountOp,
  provider: JsonRpcProvider,
  network: Network
): Promise<{
  verificationGasLimit: bigint
  gasUsed: bigint
  failure: string
}> {
  const uOp = { ...userOp }
  const IAmbireAccount = new Interface(AmbireAccount.abi)

  // add the activatorCall to the estimation
  if (uOp.activatorCall) {
    const localAccOp = { ...op }
    localAccOp.activatorCall = uOp.activatorCall
    uOp.callData = IAmbireAccount.encodeFunctionData('executeMultiple', [
      [[getSignableCalls(op), getSpoof(account)]]
    ])
  }

  if (shouldUseOneTimeNonce(uOp)) uOp.nonce = getOneTimeNonce(uOp)
  else uOp.signature = getSpoof(account)

  const deployless4337Estimator = fromDescriptor(
    provider,
    Estimation4337,
    !network.rpcNoStateOverride
  )
  return deployless4337Estimator.call('estimate', [uOp, ERC_4337_ENTRYPOINT], {
    from: DEPLOYLESS_SIMULATION_FROM,
    blockTag: 'latest'
  })
}
