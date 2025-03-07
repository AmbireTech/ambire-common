import { Interface, toBeHex, ZeroAddress } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { isSmartAccount } from '../account/account'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { TokenResult } from '../portfolio'
import { ProviderEstimation } from './interfaces'

export function getEstimateGasProps(
  op: AccountOp,
  account: Account,
  accountState: AccountOnchainState
): { from: Hex; to: Hex; value: Hex; data: Hex; useStateOverride: boolean } {
  if (accountState.isSmarterEoa) {
    const saAbi = new Interface(AmbireAccount.abi)
    return {
      from: account.addr as Hex,
      to: account.addr as Hex,
      value: '0x00',
      data: saAbi.encodeFunctionData('executeBySender', [getSignableCalls(op)]) as Hex,
      useStateOverride: false
    }
  }

  // normal EOA: a single call
  const call = op.calls[0]
  return {
    from: account.addr as Hex,
    to: call.to as Hex,
    value: toBeHex(call.value) as Hex,
    data: call.data as Hex,
    useStateOverride: false
  }
}

export async function providerEstimateGas(
  account: Account,
  op: AccountOp,
  provider: RPCProvider,
  accountState: AccountOnchainState,
  network: Network,
  feeTokens: TokenResult[]
): Promise<ProviderEstimation | Error> {
  // we don't do estimateGas() for smart accounts
  // also, there's no way to do estimateGas validly in the case of an off-chain 7702 EOA
  // as txn_type 4 needs to be broadcast and there's no way to enforce that
  // on the estimateGas(). So we're returning an error here that should
  // be disregarded in the implementation as other methods for estimation
  // should pass
  if (isSmartAccount(account) || (accountState.isSmarterEoa && accountState.authorization)) {
    return new Error('disallowed')
  }

  const feePaymentOptions = [
    {
      paidBy: account.addr,
      availableAmount: accountState.balance,
      addedNative: 0n,
      token: feeTokens.find((token) => token.address === ZeroAddress && !token.flags.onGasTank)!
    }
  ]
  const properties = getEstimateGasProps(op, account, accountState)
  if (properties.useStateOverride && !network.rpcNoStateOverride) {
    const gasUsed = await provider
      .send('eth_estimateGas', [
        {
          from: properties.from,
          to: properties.to,
          value: properties.value,
          data: properties.data,
          nonce: '0x0'
        },
        'latest',
        {
          [DEPLOYLESS_SIMULATION_FROM]: {
            balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
          }
        }
      ])
      .catch((e) => e)
    if (gasUsed instanceof Error) return gasUsed
    return {
      gasUsed: BigInt(gasUsed),
      feePaymentOptions
    }
  }

  const gasUsed = await provider
    .estimateGas({
      from: properties.from,
      to: properties.to,
      value: properties.value,
      data: properties.data,
      nonce: 0
    })
    .catch((e) => e)
  if (gasUsed instanceof Error) return gasUsed
  return {
    gasUsed: BigInt(gasUsed),
    feePaymentOptions
  }
}
