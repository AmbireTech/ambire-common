import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'

export class DelegationController extends EventEmitter {
  #accounts

  constructor(account: AccountsController) {
    super()
    this.#accounts = account
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
