import { Interface, JsonRpcProvider, Provider } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getSpoof } from '../account/account'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { getActivatorCall, shouldIncludeActivatorCall } from '../userOperation/userOperation'

export async function estimateCustomNetwork(
  account: Account,
  op: AccountOp,
  accountStates: AccountStates,
  network: NetworkDescriptor,
  provider: Provider | JsonRpcProvider
): Promise<bigint> {
  const call: Call = {
    to: '',
    value: 0n,
    data: '0x'
  }
  const accountState = accountStates[op.accountAddr][op.networkId]
  if (accountState.isDeployed) {
    const ambireAccount = new Interface(AmbireAccount.abi)
    call.to = op.accountAddr
    call.data = ambireAccount.encodeFunctionData('execute', [
      getSignableCalls(op),
      getSpoof(account)
    ])
  } else {
    const ambireFactory = new Interface(AmbireAccountFactory.abi)
    call.to = account.creation!.factoryAddr
    call.data = ambireFactory.encodeFunctionData('deployAndExecute', [
      account.creation!.bytecode,
      account.creation!.salt,
      getSignableCalls(op),
      getSpoof(account)
    ])
  }

  const calls: any = [...op.calls]
  if (!accountState.isDeployed) {
    calls.push({
      to: null,
      value: null,
      data: account.creation!.bytecode
    })
  }
  if (shouldIncludeActivatorCall(network, accountState)) {
    calls.push({
      ...getActivatorCall(op.accountAddr)
    })
  }
  // we need to be sure we're fetching the noce for the SA as an EOA
  const nonce = await provider.getTransactionCount(account.addr)
  let multiplier = 0n
  const gasUsages = await Promise.all(
    calls.map((c: any) =>
      provider
        .estimateGas({
          from: account.addr,
          to: c.to,
          value: c.value,
          data: c.data,
          nonce
        })
        .catch(() => {
          // a call in a batch could fail because we estimate the calls separately
          // (approve + transfer, transfer fails)
          // since we care only about estimation and not about validity, we increase
          // the multiplier on a failed call and will add to the end gas a successful
          // call's gas times the multiplier
          multiplier++
          return 0n
        })
    )
  )

  let gasUsed = 0n
  for (let i = 0; i < gasUsages.length; i++) {
    gasUsed += gasUsages[i]
  }
  if (multiplier > 0n) {
    const additional = gasUsages.find((num) => num > 0n) ?? 0n
    gasUsed += additional * multiplier
  }
  return gasUsed
}
