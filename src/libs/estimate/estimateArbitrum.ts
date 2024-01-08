import { Contract, Interface, JsonRpcProvider, Provider } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import ArbitrumFactoryAbi from '../../consts/arbitrumFactoryAbi.json'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { AccountOp, callToTuple } from '../accountOp/accountOp'

export async function estimateArbitrumL1GasUsed(
  accountOp: AccountOp,
  account: Account,
  accountState: AccountOnchainState,
  provider: Provider | JsonRpcProvider
): Promise<bigint> {
  // if network is not arbitrum, just return a 0n
  // additional l1 gas estimation is only needed when the account is a smart one
  if (accountOp.networkId !== 'arbitrum' || !account.creation) {
    return 0n
  }

  const IAmbireAccountFactory = new Interface(AmbireAccountFactory.abi)
  const IAmbireAccount = new Interface(AmbireAccount.abi)

  // TODO: IF IT'S ERC-4337, we should make the txData point
  // to handleOps
  const txData = accountState.isDeployed
    ? IAmbireAccount.encodeFunctionData('execute', [
        accountOp.calls.map((call) => callToTuple(call)),
        '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
      ])
    : IAmbireAccountFactory.encodeFunctionData('deployAndExecute', [
        account.creation!.bytecode,
        account.creation!.salt,
        accountOp.calls.map((call) => callToTuple(call)),
        '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
      ])

  const nodeInterface: Contract = new Contract(
    '0x00000000000000000000000000000000000000C8',
    ArbitrumFactoryAbi,
    provider
  )
  const gasEstimateComponents = await nodeInterface.gasEstimateL1Component.staticCall(
    accountOp.accountAddr,
    accountState.isDeployed,
    txData
  )
  const l2EstimatedPrice = gasEstimateComponents.baseFee
  const l1EstimatedPrice = gasEstimateComponents.l1BaseFeeEstimate * 16n
  const l1Cost = BigInt(gasEstimateComponents.gasEstimateForL1 * l2EstimatedPrice)
  const l1Size = l1Cost / l1EstimatedPrice
  return (l1EstimatedPrice * l1Size) / l2EstimatedPrice
}
