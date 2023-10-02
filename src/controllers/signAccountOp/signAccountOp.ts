import { ethers } from 'ethers'
import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { AccountOp, accountOpSignableHash, GasFeePayment } from '../../libs/accountOp/accountOp'
import { EstimateResult } from '../../libs/estimate/estimate'
import { GasRecommendation } from '../../libs/gasPrice/gasPrice'
import { Keystore } from '../../libs/keystore/keystore'
import EventEmitter from '../eventEmitter'
import { PortfolioController } from '../portfolio/portfolio'
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { Price, TokenResult } from '../../libs/portfolio'

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

  portfolio: PortfolioController

  #accounts: Account[] | null = null

  #networks: NetworkDescriptor[] | null = null

  #accountStates: AccountStates | null = null

  accountOp: AccountOp | null = null

  #gasPrices: GasRecommendation[] | null = null

  #estimation: EstimateResult | null = null

  selectedFeeSpeed: FeeSpeed = FeeSpeed.Fast

  status: Status | null = null

  constructor(keystore: Keystore, portfolio: PortfolioController) {
    super()

    this.#keystore = keystore
    this.portfolio = portfolio
  }

  get isInitialized(): boolean {
    return !!(
      this.#accounts &&
      this.#networks &&
      this.#accountStates &&
      this.accountOp &&
      this.#estimation
    )
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
    }
    const account = this.#getAccount()

    if (feeTokenAddr && paidBy && this.isInitialized) {
      const network = this.#networks!.find((n) => n.id === this.accountOp?.networkId)
      // Cannot set paidBy for EOAs or ERC-4337
      const canSetPaidBy = account?.creation && !network?.erc4337?.enabled

      // TODO: validate feeTokenAddr
      if (canSetPaidBy) {
        this.accountOp!.gasFeePayment = this.#getGasFeePayment(
          feeTokenAddr,
          this.selectedFeeSpeed,
          paidBy
        )
      }
    }

    if (speed && this.isInitialized) {
      this.selectedFeeSpeed = speed
      this.accountOp!.gasFeePayment = this.#getGasFeePayment(
        this.accountOp!.gasFeePayment?.inToken as string,
        this.selectedFeeSpeed
      )
    }

    if (signingKeyAddr && account?.creation && this.isInitialized) {
      this.accountOp!.signingKeyAddr = signingKeyAddr
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

  #getPortfolioToken(addr: string): TokenResult | undefined {
    return this.portfolio.latest?.[this.accountOp!.accountAddr]?.[
      this.accountOp!.networkId
    ]?.result?.tokens.find((token) => token.address === addr)
  }

  /**
   * Obtain the native token ratio in relation to a fee token.
   *
   * By knowing the USD value of the tokens in the portfolio,
   * we can calculate the ratio between a native token and a fee token.
   *
   * For example, 1 ETH = 8 BNB (ratio: 8).
   * We used to return decimals as well because the ratio may result in a decimal number.
   * However, once we convert it to a BigInt, we will lose precision.
   *
   * We require the ratio to be in a BigInt format since all the application values,
   * such as amount, gasLimit, etc., are also represented as BigInt numbers.
   */
  #getNativeToFeeTokenRatio(feeToken: TokenResult): { ratio: bigint; decimals: number } {
    const countDecimals = (value: number) => {
      if (value % 1 !== 0) return value.toString().split('.')[1].length

      return 0
    }

    const native = this.#getPortfolioToken('0x0000000000000000000000000000000000000000')
    const isUsd = (price: Price) => price.baseCurrency === 'usd'
    const ratio = native!.priceIn.find(isUsd)!.price / feeToken!.priceIn.find(isUsd)!.price
    const decimals = countDecimals(ratio)

    return {
      ratio: BigInt(ratio * 10 ** decimals),
      decimals
    }
  }

  #getGasFeePayment(
    feeTokenAddr: string,
    feeSpeed: FeeSpeed,
    paidBy: string = this.accountOp!.gasFeePayment?.paidBy || this.accountOp!.accountAddr
  ): GasFeePayment {
    if (!this.isInitialized) throw new Error('signAccountOp: not initialized')

    const account = this.#getAccount()
    const result = this.#gasPrices!.find((price) => price.name === feeSpeed)
    // @ts-ignore
    // It's always in wei
    const gasPrice = result.gasPrice || result!.baseFeePerGas + result!.maxPriorityFeePerGas
    const gasUsed = this.#estimation!.gasUsed

    // EOA
    if (!account || !account?.creation) {
      const simulatedGasLimit = gasUsed
      const amount = simulatedGasLimit * gasPrice + this.#estimation!.addedNative

      return {
        paidBy: this.accountOp!.accountAddr,
        isERC4337: false,
        isGasTank: false,
        inToken: '0x0000000000000000000000000000000000000000',
        amount,
        simulatedGasLimit
      }
    }

    // Smart account, but EOA pays the fee
    if (paidBy !== this.accountOp!.accountAddr) {
      // @TODO - add comment why we add 21k gas here
      const simulatedGasLimit = gasUsed + 21000n
      const amount = simulatedGasLimit * gasPrice + this.#estimation!.addedNative

      return {
        paidBy,
        isERC4337: false,
        isGasTank: false,
        inToken: feeTokenAddr,
        amount,
        simulatedGasLimit
      }
    }

    // Relayer.
    // relayer or 4337, we need to add feeTokenOutome.gasUsed
    const feeToken = this.#getPortfolioToken(feeTokenAddr)
    const nativeRatio = this.#getNativeToFeeTokenRatio(feeToken!)
    const feeTokenGasUsed = this.#estimation!.feePaymentOptions.find(
      (option) => option.address === feeTokenAddr
    )!.gasUsed!
    // @TODO - add comment why here we use `feePaymentOptions`, but we don't use it in EOA
    const simulatedGasLimit = gasUsed + feeTokenGasUsed

    const amountInWei = simulatedGasLimit * gasPrice + this.#estimation!.addedNative

    // Let's break down the process of converting the amount into FeeToken:
    // 1. Initially, we multiply the amount in wei by the native to fee token ratio.
    // 2. Next, we address the decimal places:
    // 2.1. First, we convert wei to native by dividing by 10^18 (representing the decimals).
    // 2.2. Now, with the amount in the native token, we incorporate nativeRatio.decimals into the calculation (18 + nativeRatio.decimals) to standardize the amount.
    // 2.3. At this point, we precisely determine the number of fee tokens. For instance, if the amount is 3 USDC, we must convert it to a BigInt value, while also considering feeToken.decimals.
    const amount =
      (amountInWei * nativeRatio.ratio) /
      BigInt(10 ** (18 + nativeRatio.decimals - feeToken!.decimals))

    return {
      paidBy,
      isERC4337: false, // TODO: based on network settings. We should add it to gasFeePayment interface.
      isGasTank: feeToken?.networkId === 'gasTank',
      inToken: feeTokenAddr,
      amount,
      simulatedGasLimit
    }
  }

  get feeToken(): string | null {
    return this.accountOp?.gasFeePayment?.inToken || null
  }

  get feePaidBy(): string | null {
    return this.accountOp?.gasFeePayment?.paidBy || null
  }

  get availableFeeOptions(): EstimateResult['feePaymentOptions'] {
    const account = this.#getAccount()
    if (!account || !this.isInitialized || !this.#estimation) return []

    // only the account can pay for the fee when current account is EOA
    if (!account.creation) {
      const feePaymentOption = this.#estimation.feePaymentOptions.find(
        (option) => option.address === '0x0000000000000000000000000000000000000000'
      )
      return feePaymentOption ? [feePaymentOption] : []
    }

    // @TODO - 4337 - will handle it in next Epics
    // // only the account itself can pay in this case
    // const network = this.#networks!.find((n) => n.id === this.accountOp?.networkId)
    // if (network && network.erc4337?.enabled) {
    //   return [
    //
    //   ]
    // }

    // in other modes: relayer and gas tank - current account + all EOAs can pay
    return this.#estimation.feePaymentOptions
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

    const account = this.#getAccount()
    // @TODO - we should get the signer `keyType`
    const signer = await this.#keystore.getSigner(this.accountOp.signingKeyAddr, 'internal')
    if (!account) return this.#setSigningError('non-existent account')
    if (!signer) return this.#setSigningError('no available signer')

    this.status = { type: SigningStatus.InProgress }
    this.emitUpdate()

    const gasFeePayment = this.accountOp.gasFeePayment

    try {
      // In case of EOA account
      if (!account.creation) {
        if (this.accountOp.calls.length !== 1)
          return this.#setSigningError(
            'tried to sign an EOA transaction with multiple or zero calls'
          )
        const { to, value, data } = this.accountOp.calls[0]
        this.accountOp.signature = await signer.signRawTransaction({
          to,
          value,
          data,
          gasLimit: gasFeePayment.simulatedGasLimit,
          gasPrice:
            (gasFeePayment.amount - this.#estimation!.addedNative) / gasFeePayment.simulatedGasLimit
        })
      } else if (this.accountOp.gasFeePayment.paidBy !== account.addr) {
        // Smart account, but EOA pays the fee
        // EOA pays for execute() - relayerless

        const iface = new ethers.Interface(AmbireAccount.abi)

        this.accountOp.signature = await signer.signRawTransaction({
          to: this.accountOp.accountAddr,
          data: iface.encodeFunctionData('execute', [
            this.accountOp.calls,
            await signer.signMessage(ethers.hexlify(accountOpSignableHash(this.accountOp)))
          ]),
          gasLimit: gasFeePayment.simulatedGasLimit,
          gasPrice:
            (gasFeePayment.amount - this.#estimation!.addedNative) / gasFeePayment.simulatedGasLimit
        })
      } else {
        // Relayer
        // @TODO - additional call, pseudo code, sync with Bobby/Emo about the call in case of gas tank
        this.accountOp!.signature = await signer.signMessage(
          ethers.hexlify(accountOpSignableHash(this.accountOp))
        )
      }

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
      availableFeeOptions: this.availableFeeOptions,
      feeToken: this.feeToken,
      feePaidBy: this.feePaidBy,
      speedOptions: this.speedOptions
    }
  }
}
