import { Interface } from 'ethers'
import { NetworkDescriptor } from 'interfaces/networkDescriptor'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { Account, AccountStates } from '../../interfaces/account'
import { Bundler } from '../../services/bundlers/bundler'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { UserOperation } from '../userOperation/types'
import { getUserOperation } from '../userOperation/userOperation'
import { estimationErrorFormatted } from './errors'
import { EstimateResult } from './interfaces'

function getUserOpsForEstimate(
  userOp: UserOperation,
  op: AccountOp,
  isDeployed: boolean
): UserOperation[] {
  const ambireAccount = new Interface(AmbireAccount.abi)
  const localUserOp = { ...userOp }
  const callData = ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(op)])
  const userOps = []

  if (!isDeployed) {
    const copy = { ...userOp }
    copy.initCode = '0x'
    copy.callData = callData
    userOps.push(copy)
  } else {
    localUserOp.callData = callData
  }

  userOps.push(localUserOp)
  return userOps
}

export async function bundlerEstimate(
  account: Account,
  accountStates: AccountStates,
  op: AccountOp,
  network: NetworkDescriptor
): Promise<EstimateResult> {
  const localOp = { ...op }
  localOp.activatorCall = op.activatorCall
  const accountState = accountStates[localOp.accountAddr][localOp.networkId]
  const userOp = getUserOperation(account, accountState, localOp)
  const userOps = getUserOpsForEstimate(userOp, localOp, accountState.isDeployed)
  const estimations = userOps.map((uOp) =>
    Bundler.estimate(uOp, network, accountState.isDeployed).catch(
      (e: any) =>
        new Error(
          e.body && e.body.error && e.body.error.message
            ? e.body.error.message
            : 'Estimation failed'
        )
    )
  )
  const results = await Promise.all(estimations)
  for (let i = 0; i < results.length; i++) {
    if (results[i] instanceof Error) return estimationErrorFormatted(results[i] as Error)
  }

  const gasData = {
    preVerificationGas: 0n,
    verificationGasLimit: 0n,
    callGasLimit: 0n
  }
  for (let i = 0; i < results.length; i++) {
    gasUsed += gasUsages[i]
  }

  // we will have only feeTokenOptions if the network uses a paymaster
  // and we will have only nativeTokenOptions if the network doesn't
  // - also, if it's not the edge case, nativeTokenOptions will be
  // only one - the smart account ERC-4337 zZnative broadcast

  // TODO: after everything is done, we can think of deleting erc4337estimation
  return {
    gasUsed,
    // put the userOp nonce here
    nonce,
    feePaymentOptions: [...feeTokenOptions, ...nativeTokenOptions],
    erc4337estimation,
    // the bundler handles this
    arbitrumL1FeeIfArbitrum: { noFee: 0n, withFee: 0n },
    error: estimationError
  }
}
