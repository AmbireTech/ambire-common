import { Interface, JsonRpcProvider, Provider } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { Account } from '../../interfaces/account'
import { getSpoof } from '../account/account'
import { AccountOp, callToTuple } from '../accountOp/accountOp'

export async function estimateGas(
  account: Account,
  op: AccountOp,
  provider: Provider | JsonRpcProvider
): Promise<bigint> {
  const saAbi = new Interface(AmbireAccount.abi)
  const callData = saAbi.encodeFunctionData('execute', [
    op.calls.map((call) => callToTuple(call)),
    getSpoof(account)
  ])
  return provider.estimateGas({
    from: DEPLOYLESS_SIMULATION_FROM,
    to: account.addr,
    value: 0,
    data: callData,
    nonce: 0
  })
}
