import { Interface, JsonRpcProvider, Provider } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import { Account } from '../../interfaces/account'
import { AccountOp } from '../accountOp/accountOp'

export async function refund(
  account: Account,
  op: AccountOp,
  provider: JsonRpcProvider | Provider,
  gasUsed: bigint
): Promise<bigint> {
  // WARNING: calculateRefund will 100% NOT work in all cases we have
  // So a warning not to assume this is working
  const IAmbireAccount = new Interface(AmbireAccount.abi)
  const IAmbireAccountFactory = new Interface(AmbireAccountFactory.abi)

  const accountCalldata = op.accountOpToExecuteBefore
    ? IAmbireAccount.encodeFunctionData('executeMultiple', [
        [
          [op.accountOpToExecuteBefore.calls, op.accountOpToExecuteBefore.signature],
          [op.calls, op.signature]
        ]
      ])
    : IAmbireAccount.encodeFunctionData('execute', [op.calls, op.signature])

  const factoryCalldata = IAmbireAccountFactory.encodeFunctionData('deployAndExecute', [
    account.creation!.bytecode,
    account.creation!.salt,
    [[account.addr, 0, accountCalldata]],
    op.signature
  ])

  const estimatedGas = await provider.estimateGas({
    from: '0x0000000000000000000000000000000000000001',
    to: account.creation!.factoryAddr,
    data: factoryCalldata
  })

  const estimatedRefund = gasUsed - estimatedGas

  // As of EIP-3529, the max refund is 1/5th of the entire cost
  if (estimatedRefund <= gasUsed / 5n && estimatedRefund > 0n) return estimatedGas
  return gasUsed
}
