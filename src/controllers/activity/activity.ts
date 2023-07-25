import EventEmitter from '../eventEmitter'
import { Storage } from '../../interfaces/storage'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { SignedMessage } from '../../interfaces/userRequest'

export class ActivityController extends EventEmitter {
  private storage: Storage

  constructor(storage: Storage) {
    super()
    this.storage = storage
  }

  // @TODO: Implement AccountOp status - pending | confirmed | failed
  async addAccountOp(accountOp: AccountOp) {
    const accountsOps = await this.storage.get('accountsOps', {})

    const account = accountOp.accountAddr
    const network = accountOp.networkId
    const key = `${account}:${network}`

    if (!accountsOps[key]) {
      accountsOps[key] = []
    }

    accountsOps[key].push(accountOp)

    await this.storage.set('accountsOps', accountsOps)
    this.emitUpdate()
  }

  async getAccountsOps() {
    return this.storage.get('accountsOps', {})
  }

  async addSignedMessage(signedMessage: SignedMessage, accountAddr: string) {
    const signedMessages = await this.storage.get('signedMessages', {})

    if (!signedMessages[accountAddr]) {
      signedMessages[accountAddr] = []
    }

    signedMessages[accountAddr].push(signedMessage)

    await this.storage.set('signedMessages', signedMessages)
    this.emitUpdate()
  }

  async getSignedMessages() {
    return this.storage.get('signedMessages', {})
  }
}
