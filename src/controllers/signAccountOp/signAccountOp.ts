import { Account, AccountStates } from '../../interfaces/account'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { AccountOp } from 'libs/accountOp/accountOp'

export class SignAccountOpController extends EventEmitter {
  #keystore: KeystoreController
  #accounts: Account[]
  #accountStates: AccountStates

  constructor(
    keystore: KeystoreController,
    accounts: Account[],
    accountStates: AccountStates
  ) {
    super()

    this.#keystore = keystore
    this.#accounts = accounts
    this.#accountStates = accountStates
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
    // TODO: this is not correct
    // we should check if the length of the keys is more than 1
    // if it is, the user should be prompt to choose which key
    // he wants. In other words, we need a middle state before proceeding
    const signingKey = keys[0]
    const signer = this.#keystore.getSigner(signingKey.addr, signingKey.type)
    if (!signer) {
      return this.emitError({
        level: 'major',
        message: 'Please select a signing key and try again.',
        error: new Error('Signing key not found.')
      })
    }

    const accountStateAccrossNetworks = this.#accountStates[accountOp.accountAddr]
    const accountState = accountStateAccrossNetworks.length
        ? accountStateAccrossNetworks[accountOp.networkId]
        : null
    if (!accountState) {
      return this.emitError({
        level: 'major',
        message: 'Please refresh and try again.',
        error: new Error(`sign: account state not found for ${accountOp.accountAddr}`)
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

        // if isErc4337Enabled is false and the account is deployed,
        // we need to prepare executeMultiple and a sign from the paymaster
        // executeMultiple should give permissions to the entry point
        // and execute the normal txn the user wanted

        // sign
    }
  }
}
