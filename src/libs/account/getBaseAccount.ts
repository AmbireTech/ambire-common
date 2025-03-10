import { Account, AccountOnchainState } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { canBecomeSmarterOnChain } from './account'
import { BaseAccount } from './BaseAccount'
import { EOA } from './EOA'
import { EOA7702 } from './EOA7702'
import { V1 } from './V1'
import { V2 } from './V2'

export function getBaseAccount(
  account: Account,
  accountState: AccountOnchainState,
  accountKeys: Key[]
): BaseAccount {
  if (accountState.isEOA) {
    if (accountState.isSmarterEoa || canBecomeSmarterOnChain(account, accountState, accountKeys)) {
      return new EOA7702(account)
    }

    return new EOA(account)
  }

  return accountState.isV2 ? new V2(account) : new V1(account)
}
