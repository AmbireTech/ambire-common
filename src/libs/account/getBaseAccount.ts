import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { canBecomeSmarterOnChain, shouldBecomeSmarterAutomatically } from './account'
import { BaseAccount } from './BaseAccount'
import { EOA } from './EOA'
import { EOA7702 } from './EOA7702'
import { Safe } from './Safe'
import { V1 } from './V1'
import { V2 } from './V2'

export function getBaseAccount(
  account: Account,
  accountState: AccountOnchainState,
  network: Network,
  isErc4337Enabled: boolean,
  isErc7702Enabled: boolean
): BaseAccount {
  if (account.safeCreation) return new Safe(account, network, accountState, isErc4337Enabled)
  if (accountState.isEOA) {
    // an account that is already upgraded onchain always behaves as one. The
    // rest are upgraded on their own only if their keys allow it, see
    // shouldBecomeSmarterAutomatically
    const shouldBeSmarter =
      accountState.isSmarterEoa ||
      (canBecomeSmarterOnChain(network, account, accountState) &&
        shouldBecomeSmarterAutomatically(accountState.importedAccountKeys))

    if (isErc7702Enabled && shouldBeSmarter) {
      return new EOA7702(account, network, accountState, isErc4337Enabled)
    }

    return new EOA(account, network, accountState, isErc4337Enabled)
  }

  return accountState.isV2
    ? new V2(account, network, accountState, isErc4337Enabled)
    : new V1(account, network, accountState, isErc4337Enabled)
}
