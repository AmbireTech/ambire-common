import { Account } from '../../interfaces/account'
import { has7702 } from '../../libs/7702/7702'
import { canBecomeSmarter } from '../../libs/account/account'
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { AccountDelegation, ChainDelegation } from './types'

export class DelegationController extends EventEmitter {
  #accounts: AccountsController

  #networks: NetworksController

  #selectedAccount: SelectedAccountController

  #keystore: KeystoreController

  constructor(
    account: AccountsController,
    network: NetworksController,
    selectedAccount: SelectedAccountController,
    keystore: KeystoreController
  ) {
    super()
    this.#accounts = account
    this.#networks = network
    this.#selectedAccount = selectedAccount
    this.#keystore = keystore
  }

  #getAccountDelegations(account: Account | null): ChainDelegation | null {
    if (!account) return null
    if (!this.#accounts.accountStates[account.addr]) return null

    const delegations: ChainDelegation = {}

    this.delegationNetworks.forEach((net) => {
      const accountState = this.#accounts.accountStates[account.addr][net.chainId.toString()]
      if (!accountState) return

      delegations[net.chainId.toString()] = {
        has: !!accountState.delegatedContract,
        delegatedContract: accountState.delegatedContract
      }
    })

    return delegations
  }

  get delegationNetworks() {
    return this.#networks.networks.filter((net) => has7702(net))
  }

  get delegations(): ChainDelegation | null {
    return this.#getAccountDelegations(this.#selectedAccount.account)
  }

  get is7702() {
    if (!this.#selectedAccount.account) return false

    return canBecomeSmarter(
      this.#selectedAccount.account,
      this.#keystore.keys.filter((key) =>
        this.#selectedAccount.account!.associatedKeys.includes(key.addr)
      )
    )
  }

  get accountDelegations(): AccountDelegation {
    const delegations: AccountDelegation = {}

    this.#accounts.accounts.forEach((account) => {
      delegations[account.addr] = this.#getAccountDelegations(account)
    })

    return delegations
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      delegations: this.delegations,
      delegationNetworks: this.delegationNetworks,
      is7702: this.is7702,
      accountDelegations: this.accountDelegations
    }
  }
}
