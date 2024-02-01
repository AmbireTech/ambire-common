import { AbiCoder, Contract, Interface, JsonRpcProvider, Provider } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import EntryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import ArbitrumFactoryAbi from '../../consts/arbitrumFactoryAbi.json'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { UserOperation } from '../userOperation/types'
import { getCleanUserOp } from '../userOperation/userOperation'

function getTxnData(
  accountState: AccountOnchainState,
  account: Account,
  calls: [string, string, string][],
  userOp: UserOperation,
  is4337Broadcast: boolean
) {
  if (is4337Broadcast) {
    const EntryPoint = new Interface(EntryPointAbi)
    return EntryPoint.encodeFunctionData('handleOps', [getCleanUserOp(userOp), account.addr])
  }

  const IAmbireAccountFactory = new Interface(AmbireAccountFactory.abi)
  const IAmbireAccount = new Interface(AmbireAccount.abi)
  return accountState.isDeployed
    ? IAmbireAccount.encodeFunctionData('execute', [
        calls,
        '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
      ])
    : IAmbireAccountFactory.encodeFunctionData('deployAndExecute', [
        account.creation!.bytecode,
        account.creation!.salt,
        calls,
        '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
      ])
}

function getL1GasUsed(gasEstimateComponents: {
  baseFee: bigint
  l1BaseFeeEstimate: bigint
  gasEstimateForL1: bigint
}) {
  const l2EstimatedPrice = gasEstimateComponents.baseFee
  const l1EstimatedPrice = gasEstimateComponents.l1BaseFeeEstimate * 16n
  const l1Cost = BigInt(gasEstimateComponents.gasEstimateForL1 * l2EstimatedPrice)
  const l1Size = l1Cost / l1EstimatedPrice
  return (l1EstimatedPrice * l1Size) / l2EstimatedPrice
}

export async function estimateArbitrumL1GasUsed(
  accountOp: AccountOp,
  account: Account,
  accountState: AccountOnchainState,
  provider: Provider | JsonRpcProvider,
  userOp: UserOperation,
  is4337Broadcast: boolean
): Promise<{ noFee: bigint; withFee: bigint }> {
  // if network is not arbitrum, just return a 0n
  // additional l1 gas estimation is only needed when the account is a smart one
  if (accountOp.networkId !== 'arbitrum' || !account.creation) {
    return { noFee: 0n, withFee: 0n }
  }

  const op = { ...accountOp }
  const callsWithoutFee = getSignableCalls(op)
  const abiCoder = new AbiCoder()
  op.feeCall = {
    to: FEE_COLLECTOR,
    value: 0n,
    data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', 100, 'USDC'])
  }
  const callsWithFee = getSignableCalls(op)
  delete op.feeCall

  const nodeInterface: Contract = new Contract(
    '0x00000000000000000000000000000000000000C8',
    ArbitrumFactoryAbi,
    provider
  )
  const [gasEstimateComponentsNoFee, gasEstimateComponentsWithFee] = await Promise.all([
    nodeInterface.gasEstimateL1Component.staticCall(
      op.accountAddr,
      accountState.isDeployed,
      getTxnData(accountState, account, callsWithoutFee, userOp, is4337Broadcast)
    ),
    nodeInterface.gasEstimateL1Component.staticCall(
      op.accountAddr,
      accountState.isDeployed,
      getTxnData(accountState, account, callsWithFee, userOp, is4337Broadcast)
    )
  ])
  return {
    noFee: getL1GasUsed(gasEstimateComponentsNoFee),
    withFee: getL1GasUsed(gasEstimateComponentsWithFee)
  }
}
