import { JsonRpcProvider, Provider } from 'ethers'

import { Account, AccountStates } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { getActivatorCall } from '../userOperation/userOperation'

export async function estimateCustomNetwork(
  account: Account,
  op: AccountOp,
  accountStates: AccountStates,
  network: Network,
  provider: Provider | JsonRpcProvider
): Promise<bigint> {
  const calls: any = [...op.calls]
  calls.push({
    ...getActivatorCall(op.accountAddr)
  })

  // we need to be sure we're fetching the noce for the SA as an EOA
  const nonce = await provider.getTransactionCount(account.addr)
  let multiplier = 0n
  const gasUsages = await Promise.all(
    calls.map((c: Call) =>
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
