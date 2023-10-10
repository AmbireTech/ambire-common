import { Account } from '../../interfaces/account'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { AccountOp } from 'libs/accountOp/accountOp'

export class SignAccountOpController extends EventEmitter {
  #keystore: KeystoreController
  #accounts: Account[]

  constructor(
    keystore: KeystoreController,
    accounts: Account[]
  ) {
    super()

    this.#keystore = keystore
    this.#accounts = accounts
  }

  async sign(accountOp: AccountOp) {
    const account = this.#accounts.find((x) => x.addr === accountOp.accountAddr)
    if (!account) {
      return this.emitError({
        level: 'major',
        message: 'Please select a signing key and try again.',
        error: new Error(`sign: called for non-existant acc ${accountOp.accountAddr}`)
      })
    }

    if (!accountOp.signingKeyAddr) {
      return this.emitError({
        level: 'major',
        message: 'Please select a signing key and try again.',
        error: new Error('No signer selected.')
      })
    }
    const keys = this.#keystore.keys.filter(key => key.addr == accountOp.signingKeyAddr)
    if (!keys.length) {
      return this.emitError({
        level: 'major',
        message: 'Please select a signing key and try again.',
        error: new Error('Signing key not found.')
      })
    }
    const signingKey = keys[0]
    const signer = this.#keystore.getSigner(signingKey.addr, signingKey.type)
    if (!signer) {
      return this.emitError({
        level: 'major',
        message: 'Please select a signing key and try again.',
        error: new Error('Signing key not found.')
      })
    }

    if (!accountOp.gasFeePayment) {
      return this.emitError({
        level: 'major',
        message: 'Please select a gas fee payment and try again.',
        error: new Error('No gas fee selected.')
      })
    }

    if (accountOp.gasFeePayment.isERC4337) {
        // TODO
        // transform accountOp to userOperation
        // sign
    }
  }
}
