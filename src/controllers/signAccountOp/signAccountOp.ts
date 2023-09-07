import { ethers } from 'ethers'

import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { AccountOp, accountOpSignableHash } from '../../libs/accountOp/accountOp'
import { EstimateResult } from '../../libs/estimate/estimate'
import { GasRecommendation } from '../../libs/gasPrice/gasPrice'
import { Keystore } from '../../libs/keystore/keystore'
import EventEmitter from '../eventEmitter'

export enum SigningStatus {
  UnableToSign = 'unable-to-sign',
  ReadyToSign = 'ready-to-sign',
  InProgress = 'in-progress',
  InProgressAwaitingUserInput = 'in-progress-awaiting-user-input',
  Done = 'done'
}

type UnableToSignStatus = {
  type: SigningStatus.UnableToSign
  error: string
}

export type Status =
  | UnableToSignStatus
  | {
      type: Exclude<SigningStatus, SigningStatus.UnableToSign>
    }

export enum FeeSpeed {
  Slow = 'slow',
  Medium = 'medium',
  Fast = 'fast',
  Ape = 'ape'
}

export class SignAccountOpController extends EventEmitter {
  #keystore: Keystore

  #accounts: Account[] | null = null

  #networks: NetworkDescriptor[] | null = null

  #accountStates: AccountStates | null = null

  accountOp: AccountOp | null = null

  #gasPrices: GasRecommendation[] | null = null

  #estimation: EstimateResult | null = null

  feeSpeed: FeeSpeed = FeeSpeed.Fast

  status: Status | null = null

  constructor(keystore: Keystore) {
    super()
    this.#keystore = keystore
  }

  get isInitialized(): boolean {
    return !!(this.#accounts && this.#networks && this.#accountStates && this.accountOp)
  }

  get hasSelectedAccountOp() {
    return !!this.accountOp
  }

  get #account(): Account | null {
    if (this.accountOp && this.#accounts) {
      const account = this.#accounts.find((acc) => acc.addr === this.accountOp!.accountAddr)
      if (account) return account
    }
    return null
  }

  get readyToSign() {
    return !!this.status && this.status?.type === SigningStatus.ReadyToSign
  }

  update({
    accounts,
    networks,
    accountStates,
    accountOp,
    gasPrices,
    estimation
  }: {
    accounts?: Account[]
    networks?: NetworkDescriptor[]
    accountStates?: AccountStates
    accountOp?: AccountOp
    gasPrices?: GasRecommendation[]
    estimation?: EstimateResult
  }) {
    if (accounts) this.#accounts = accounts
    if (networks) this.#networks = networks
    if (accountStates) this.#accountStates = accountStates
    if (gasPrices) this.#gasPrices = gasPrices
    if (estimation) this.#estimation = estimation
    if (accountOp) {
      if (!this.accountOp) {
        this.accountOp = accountOp
      } else if (
        this.accountOp.accountAddr === accountOp.accountAddr &&
        this.accountOp.networkId === accountOp.networkId
      ) {
        this.accountOp = accountOp
      }
    }

    if (this.isInitialized && this.#estimation) {
      this.status = { type: SigningStatus.ReadyToSign }
    }
    this.emitUpdate()
  }

  reset() {
    this.accountOp = null
    this.#gasPrices = null
    this.#estimation = null
    this.feeSpeed = FeeSpeed.Fast
    this.status = null
    this.emitUpdate()
  }

  #getGasFeePayment(feeTokenAddr: string, feeSpeed: FeeSpeed) {
    if (!this.isInitialized) throw new Error('signAccountOp: not initialized')

    if (!this.#account || !this.#account?.creation) {
      throw new Error('EOA is not supported yet')
      // TODO: implement for EOA and remove the !this.#account?.creation condition
    }

    const result = this.#gasPrices!.find((price) => price.name === feeSpeed)

    // @ts-ignore
    const price = result.gasPrice || result!.baseFeePerGas + result!.maxPriorityFeePerGas

    return {
      paidBy: this.accountOp!.gasFeePayment?.paidBy || this.accountOp!.accountAddr,
      isERC4337: false, // TODO: based on network settings. We should add it to gasFeePayment interface.
      isGasTank: false, // TODO: based on token network (could be gas tank network). We should add it to gasFeePayment interface.
      inToken: feeTokenAddr,
      amount: this.#estimation!.gasUsed * price
    }
  }

  setFeeToken(feeTokenAddr: string) {
    if (!this.accountOp || !feeTokenAddr) return
    // TODO: validate feeTokenAddr

    this.accountOp.gasFeePayment = this.#getGasFeePayment(feeTokenAddr, this.feeSpeed)
  }

  async sign() {
    if (!this.accountOp?.signingKeyAddr) {
      // @ts-ignore
      this.emitError({
        /* TODO: */
      })

      return
    }

    if (!this.readyToSign) return

    this.status = { type: SigningStatus.InProgress }
    this.emitUpdate()

    try {
      const signer = await this.#keystore.getSigner(this.accountOp.signingKeyAddr)

      this.accountOp.signature = await signer.signMessage(
        ethers.hexlify(accountOpSignableHash(this.accountOp))
      )
      this.status = { type: SigningStatus.Done }
      this.emitUpdate()
    } catch (error: any) {
      this.status = { type: SigningStatus.UnableToSign, error: `Signing failed: ${error?.message}` }
    }
    // TODO: Now, the UI needs to call mainCtrl.broadcastSignedAccountOp(mainCtrl.signAccountOp.accountOp)
  }
}
