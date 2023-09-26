import { ethers } from 'ethers'
import { Storage } from 'interfaces/storage'
import { callsHumanizer } from 'libs/humanizer'
import { IrCall } from 'libs/humanizer/interfaces'

import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { AccountOp, accountOpSignableHash } from '../../libs/accountOp/accountOp'
import { EstimateResult } from '../../libs/estimate/estimate'
import { GasRecommendation } from '../../libs/gasPrice/gasPrice'
import { Keystore } from '../../libs/keystore/keystore'
import EventEmitter from '../eventEmitter'
import { PortfolioController } from '../portfolio/portfolio'

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

  #portfolio: PortfolioController

  #storage: Storage

  #fetch: Function

  #accounts: Account[] | null = null

  #networks: NetworkDescriptor[] | null = null

  #accountStates: AccountStates | null = null

  accountOp: AccountOp | null = null

  #gasPrices: GasRecommendation[] | null = null

  #estimation: EstimateResult | null = null

  selectedFeeSpeed: FeeSpeed = FeeSpeed.Fast

  humanReadable: IrCall[] = []

  status: Status | null = null

  constructor(
    keystore: Keystore,
    portfolio: PortfolioController,
    storage: Storage,
    fetch: Function
  ) {
    super()

    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#storage = storage
    this.#fetch = fetch
  }

  get isInitialized(): boolean {
    return !!(this.#accounts && this.#networks && this.#accountStates && this.accountOp)
  }

  get hasSelectedAccountOp() {
    return !!this.accountOp
  }

  get readyToSign() {
    return !!this.status && this.status?.type === SigningStatus.ReadyToSign
  }

  update({
    accountOp,
    gasPrices,
    estimation,
    feeTokenAddr,
    paidBy,
    speed,
    signingKeyAddr
  }: {
    accountOp?: AccountOp
    gasPrices?: GasRecommendation[]
    estimation?: EstimateResult
    feeTokenAddr?: string
    paidBy?: string
    speed?: FeeSpeed
    signingKeyAddr?: string
  }) {
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
      // TODO: add knownAddresses
      callsHumanizer(this.accountOp, [], this.#storage, this.#fetch, (humanizedCalls) => {
        this.humanReadable = humanizedCalls
      })
    }

    if (feeTokenAddr && this.isInitialized) {
      // TODO: validate feeTokenAddr
      this.accountOp!.gasFeePayment = this.#getGasFeePayment(feeTokenAddr, this.selectedFeeSpeed)
    }

    if (paidBy && this.isInitialized) {
      // the self-invoking func allows us to return from it without interrupting the execution of the update func
      ;(() => {
        const account = this.#getAccount()
        // Cannot set paidBy for EOAs or ERC-4337
        const network = this.#networks!.find((n) => n.id === this.accountOp?.networkId)
        if (!account || !account.creation || (network && network.erc4337?.enabled)) return

        if (!this.accountOp!.gasFeePayment) this.accountOp!.gasFeePayment = {} as any
        // No need to update anything else, availableFeeTokens will change it's output
        this.accountOp!.gasFeePayment!.paidBy = paidBy
        const availableFeeTokens = this.availableFeeTokens
        if (!availableFeeTokens!.includes(this.accountOp!.gasFeePayment?.inToken as string)) {
          this.accountOp!.gasFeePayment = this.#getGasFeePayment(
            availableFeeTokens[0],
            this.selectedFeeSpeed
          )
          // we need to set it again cause getGasFeePayment will reset it
          this.accountOp!.gasFeePayment.paidBy = paidBy
        }
      })()
    }

    if (speed && this.isInitialized) {
      this.selectedFeeSpeed = speed
      this.accountOp!.gasFeePayment = this.#getGasFeePayment(
        this.accountOp!.gasFeePayment?.inToken as string,
        this.selectedFeeSpeed
      )
    }

    if (signingKeyAddr && this.isInitialized) {
      // the self-invoking func allows us to return from it without interrupting the execution of the update func
      ;() => {
        const account = this.#getAccount()
        if (!account || !account.creation) return
        this.accountOp!.signingKeyAddr = signingKeyAddr
      }
    }

    this.updateReadyToSignStatusOnUpdate()
    this.emitUpdate()
  }

  /**
   * We decided to split the update method into two separate methods: update and updateMainDeps,
   * only to separate user-related information (such as paidBy, feeTokenAddr, etc.)
   * from the main components (such as accounts, networks, etc.).
   * There is nothing more than that.
   */
  updateMainDeps({
    accounts,
    networks,
    accountStates
  }: {
    accounts?: Account[]
    networks?: NetworkDescriptor[]
    accountStates?: AccountStates
  }) {
    if (accounts) this.#accounts = accounts
    if (networks) this.#networks = networks
    if (accountStates) this.#accountStates = accountStates

    this.updateReadyToSignStatusOnUpdate()
    this.emitUpdate()
  }

  updateReadyToSignStatusOnUpdate() {
    if (
      this.isInitialized &&
      this.#estimation &&
      this.accountOp?.signingKeyAddr &&
      this.accountOp?.gasFeePayment
    ) {
      this.status = { type: SigningStatus.ReadyToSign }
    } else {
      // @TODO - let's consider is this status the right one we need to set, if the above condition is not met.
      //   imo - when we call this.update or this.updateMain, we tend to update at least 1 property, therefore inProgress sounds reasonable
      this.status = { type: SigningStatus.InProgress }
    }
  }

  reset() {
    this.accountOp = null
    this.#gasPrices = null
    this.#estimation = null
    this.selectedFeeSpeed = FeeSpeed.Fast
    this.status = null
    this.emitUpdate()
  }

  // internal helper to get the account
  #getAccount(): Account | null {
    if (!this.accountOp || !this.#accounts) return null
    const account = this.#accounts.find((x) => x.addr === this.accountOp!.accountAddr)
    if (!account) {
      throw new Error(`accountOp selected with non-existant account: ${this.accountOp.accountAddr}`)
    }
    return account
  }

  #getGasFeePayment(feeTokenAddr: string, feeSpeed: FeeSpeed) {
    if (!this.isInitialized) throw new Error('signAccountOp: not initialized')

    const account = this.#getAccount()
    if (!account || !account?.creation) {
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

  get availableFeeTokens(): string[] {
    if (!this.isInitialized) return []

    const account = this.#getAccount()

    if (!account) return []
    // TODO:
    return []
    //   const EOAs = this.#accounts!.filter((acc) => !acc.creation)
    //   // current account is an EOA or an EOA is paying the fee
    //   if (!account.creation || EOAs.includes(this.accountOp!.gasFeePayment.paidBy)) return [native]
    //   // @TODO return everything incl gas tank, with amounts; based on estimation + gas tank data from portfolio
  }

  get feeToken(): string | null {
    return this.accountOp?.gasFeePayment?.inToken || null
  }

  get availableFeePaidBy() {
    const account = this.#getAccount()
    if (!account || !this.isInitialized) return []

    // only the account can pay for the fee in EOA mode
    if (!account.creation) return [this.accountOp!.accountAddr]

    // only the account itself can pay in this case
    const network = this.#networks!.find((n) => n.id === this.accountOp?.networkId)
    if (network && network.erc4337?.enabled) {
      return [this.accountOp!.accountAddr]
    }

    // in other modes: relayer, gas tank
    // current account + all EOAs
    return [this.accountOp!.accountAddr].concat(
      this.#accounts!.filter((acc) => !acc.creation).map((acc) => acc.addr)
    )
  }

  get feePaidBy(): string | null {
    return this.accountOp?.gasFeePayment?.paidBy || null
  }

  // eslint-disable-next-line class-methods-use-this
  get speedOptions() {
    return Object.values(FeeSpeed) as string[]
  }

  #setSigningError(error: string) {
    this.status = { type: SigningStatus.UnableToSign, error }
    this.emitUpdate()
  }

  async sign() {
    if (!this.accountOp?.signingKeyAddr) return this.#setSigningError('no signing key set')
    if (!this.accountOp?.gasFeePayment) return this.#setSigningError('no gasFeePayment set')
    if (!this.readyToSign) return this.#setSigningError('not ready to sign')

    this.status = { type: SigningStatus.InProgress }
    this.emitUpdate()

    try {
      const signer = await this.#keystore.getSigner(this.accountOp!.signingKeyAddr)

      this.accountOp!.signature = await signer.signMessage(
        ethers.hexlify(accountOpSignableHash(this.accountOp!))
      )
      this.status = { type: SigningStatus.Done }
      this.emitUpdate()
    } catch (error: any) {
      this.#setSigningError(`Signing failed: ${error?.message}`)
    }
    // TODO: Now, the UI needs to call mainCtrl.broadcastSignedAccountOp(mainCtrl.signAccountOp.accountOp)
  }

  toJSON() {
    return {
      ...this,
      isInitialized: this.isInitialized,
      hasSelectedAccountOp: this.hasSelectedAccountOp,
      readyToSign: this.readyToSign,
      availableFeePaidBy: this.availableFeePaidBy,
      feeToken: this.feeToken,
      feePaidBy: this.feePaidBy,
      speedOptions: this.speedOptions
    }
  }
}
