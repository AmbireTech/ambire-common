import { Hex } from '../../interfaces/hex'
import { has7702 } from '../../libs/7702/7702'
import { canBecomeSmarter } from '../../libs/account/account'
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'

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

  get delegationNetworks() {
    return this.#networks.networks.filter((net) => has7702(net))
  }

  get delegations(): { [chainId: string]: { has: boolean; delegatedContract: Hex } } | null {
    if (!this.#selectedAccount.account) return null
    if (!this.#accounts.accountStates[this.#selectedAccount.account.addr]) return null

    const delegations: { [chainId: string]: { has: boolean; delegatedContract: Hex } } = {}
    this.delegationNetworks.forEach((net) => {
      const accountState =
        this.#accounts.accountStates[this.#selectedAccount.account!.addr][net.chainId.toString()]
      if (!accountState) return

      delegations[net.chainId.toString()] = {
        has: !!accountState.delegatedContract,
        delegatedContract: accountState.delegatedContract
      }
    })

    return delegations
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

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      delegations: this.delegations,
      delegationNetworks: this.delegationNetworks,
      is7702: this.is7702
    }
  }
}
