import { ethers } from 'ethers'
import EventEmitter from '../eventEmitter'
import { Keystore } from '../../libs/keystore/keystore'
import { AccountOp, accountOpSignableHash, GasFeePaymentType } from '../../libs/accountOp/accountOp'
import { Account } from '../../interfaces/account'
import { GasRecommendation } from '../../libs/gasPrice/gasPrice'
import { EstimateResult } from '../../libs/estimate/estimate'

enum SigningStatus {
  UnableToSign = 'unable-to-sign',
  ReadyToSign = 'ready-to-sign',
  InProgress = 'in-progress',
  InProgressAwaitingUserInput = 'in-progress-awaiting-user-input',
  Done = 'done'
}

enum FeeSpeed {
  Slow = 'slow',
  Medium = 'medium',
  Fast = 'fast',
  Ape = 'ape'
}

// @TODO - consider which props should be public/private
export class SignAccountOpController extends EventEmitter {
  accountOp: AccountOp | null = null

  #gasPrices: GasRecommendation[] | null = null

  #estimation: EstimateResult | null = null

  feeSpeed: FeeSpeed = FeeSpeed.Slow

  #keystore: Keystore

  #accounts: Account[] | null = null

  status: SigningStatus | null = null

  constructor(keystore: Keystore) {
    super()
    this.#keystore = keystore
  }

  init(
    accountOp: AccountOp,
    gasPrices: GasRecommendation[],
    estimation: EstimateResult,
    accounts: Account[],
    feeToken: string
  ) {
    this.accountOp = accountOp
    this.#gasPrices = gasPrices
    this.#estimation = estimation
    this.#accounts = accounts

    // Set default values
    this.setFeeToken(feeToken)
  }

  reset() {
    // no need to reset this.accounts since we just use it on-demand based on the current accountOp
    this.accountOp = null
  }

  // internal helper to get the account
  #getAccount(): Account | null {
    if (!this.accountOp || !this.#accounts) return null

    const account = this.#accounts.find((x) => x.addr === this.accountOp!.accountAddr)

    if (!account)
      throw new Error(`accountOp selected with non-existant account: ${this.accountOp.accountAddr}`)

    return account
  }

  #getGasFeePayment(feeTokenAddr: string, feeSpeed: FeeSpeed) {
    if (!this.accountOp) throw new Error('cannot be called before .accountOp is set')
    const account = this.#getAccount()

    if (!account || !account.creation) {
      throw new Error('EOA is not supported yet')

      // return {
      //   // @TODO data for EOA
      // }
    }

    const result = this.#gasPrices!.find((price) => price.name === feeSpeed)

    // @ts-ignore
    const price = result.gasPrice || result!.baseFeePerGas + result!.maxPriorityFeePerGas

    return {
      paidBy: this.accountOp.gasFeePayment?.paidBy || this.accountOp.accountAddr,
      paymentType: GasFeePaymentType.AmbireRelayer, // @TODO remove it. It's still not merged in v2
      // isERC4337: false, // @TODO based on network settings. We should add it to gasFeePayment interface.
      // isGasTank: false, // @TODO based on token network (could be gas tank network). We should add it to gasFeePayment interface.
      inToken: feeTokenAddr,
      amount: this.#estimation!.gasUsed * price
    }
  }

  setFeeToken(feeTokenAddr: string) {
    // @TODO validate feeTokenAddr
    if (!this.accountOp) return

    this.accountOp.gasFeePayment = this.#getGasFeePayment(feeTokenAddr, this.feeSpeed)
  }

  async sign() {
    if (!this.accountOp?.signingKeyAddr) {
      // @ts-ignore
      this.emitError({
        /* TODO */
      })

      return
    }

    const signer = await this.#keystore.getSigner(this.accountOp.signingKeyAddr)

    this.status = SigningStatus.InProgress // @TODO awaiting user input if we have indications of this
    this.emitUpdate()
    this.accountOp.signature = await signer.signMessage(
      ethers.hexlify(accountOpSignableHash(this.accountOp))
    )
    this.status = SigningStatus.Done
    this.emitUpdate()
    // Now, the UI needs to call mainCtrl.broadcastSignedAccountOp(mainCtrl.signAccountOp.accountOp)
    // @TODO
  }
}
