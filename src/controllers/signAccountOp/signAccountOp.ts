import { ethers, JsonRpcProvider } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { Account } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { AccountOp, accountOpSignableHash, GasFeePayment } from '../../libs/accountOp/accountOp'
import { EstimateResult } from '../../libs/estimate/estimate'
import { GasRecommendation } from '../../libs/gasPrice/gasPrice'
import { callsHumanizer } from '../../libs/humanizer'
import { IrCall } from '../../libs/humanizer/interfaces'
import { Price, TokenResult } from '../../libs/portfolio'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'
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

function getTokenUsdAmount(token: TokenResult, gasAmount: bigint): string {
  const isUsd = (price: Price) => price.baseCurrency === 'usd'
  const usdPrice = BigInt(token.priceIn.find(isUsd)!.price * 1e18)

  // 18 it's because we multiply usdPrice * 1e18 and here we need to deduct it
  return ethers.formatUnits(gasAmount * usdPrice, 18 + token.decimals)
}

/**
 * In Ambire, signatures have types. The last byte of each signature
 * represents its type. Description in: SignatureValidator -> SignatureMode.
 * To indicate that we want to perform an ETH sign, we have to add a 01
 * hex (equal to the number 1) at the end of the signature.
 *
 * @param sig hex string
 * @returns hex string
 */
function wrapEthSign(sig: string): string {
  return `${sig}${'01'}`
}

export class SignAccountOpController extends EventEmitter {
  #keystore: KeystoreController

  #portfolio: PortfolioController

  #storage: Storage

  #fetch: Function

  #providers: { [key: string]: JsonRpcProvider }

  #account: Account

  #network: NetworkDescriptor

  accountOp: AccountOp

  #gasPrices: GasRecommendation[] | null = null

  #estimation: EstimateResult | null = null

  paidBy: string | null = null

  selectedTokenAddr: string | null = null

  selectedFeeSpeed: FeeSpeed = FeeSpeed.Fast

  humanReadable: IrCall[] = []

  status: Status | null = null

  constructor(
    keystore: KeystoreController,
    portfolio: PortfolioController,
    account: Account,
    network: NetworkDescriptor,
    accountOp: AccountOp,
    storage: Storage,
    fetch: Function,
    providers: { [key: string]: JsonRpcProvider }
  ) {
    super()
    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#account = account
    this.#network = network
    this.accountOp = accountOp
    this.#storage = storage
    this.#fetch = fetch
    this.#providers = providers
  }

  get isInitialized(): boolean {
    return !!(this.#account && this.#network && this.accountOp && this.#estimation)
  }

  get errors(): string[] {
    const errors: string[] = []

    if (!this.isInitialized) return errors

    if (!this.availableFeeOptions.length)
      errors.push(
        "We are unable to estimate your transaction as you don't have tokens with balances to cover the fee."
      )

    if (!this.accountOp?.gasFeePayment)
      errors.push('Please select a token and an account for paying the gas fee.')

    if (this.accountOp?.gasFeePayment && this.availableFeeOptions.length) {
      const feeToken = this.availableFeeOptions.find(
        (feeOption) =>
          feeOption.paidBy === this.accountOp?.gasFeePayment?.paidBy &&
          feeOption.address === this.accountOp?.gasFeePayment?.inToken
      )

      if (feeToken!.availableAmount < this.accountOp?.gasFeePayment.amount) {
        errors.push(
          "Signing is not possible with the selected account's token as it doesn't have sufficient funds to cover the gas payment fee."
        )
      }
    }

    // If signing fails, we know the exact error and aim to forward it to the remaining errors,
    // as the application will exclusively render `signAccountOp.errors`.
    if (this.status?.type === SigningStatus.UnableToSign) {
      errors.push(this.status.error)
    }

    return errors
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
    signingKeyAddr,
    signingKeyType
  }: {
    accountOp?: AccountOp
    gasPrices?: GasRecommendation[]
    estimation?: EstimateResult
    feeTokenAddr?: string
    paidBy?: string
    speed?: FeeSpeed
    signingKeyAddr?: Key['addr']
    signingKeyType?: Key['type']
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
      callsHumanizer(
        this.accountOp,
        {},
        this.#storage,
        this.#fetch,
        (humanizedCalls) => {
          this.humanReadable = humanizedCalls
          this.emitUpdate()
        },
        (err) => this.emitError(err)
      )
    }

    if (feeTokenAddr && paidBy) {
      this.paidBy = paidBy
      this.selectedTokenAddr = feeTokenAddr
    }

    if (speed && this.isInitialized) {
      this.selectedFeeSpeed = speed
    }

    if (signingKeyAddr && signingKeyType && this.isInitialized) {
      this.accountOp!.signingKeyAddr = signingKeyAddr
      this.accountOp!.signingKeyType = signingKeyType
    }

    // Setting defaults
    if (this.availableFeeOptions.length && !this.paidBy && !this.selectedTokenAddr) {
      const defaultFeeOption = this.availableFeeOptions[0]

      this.paidBy = defaultFeeOption.paidBy
      this.selectedTokenAddr = defaultFeeOption.address
    }

    if (this.isInitialized && this.paidBy && this.selectedTokenAddr && this.selectedFeeSpeed) {
      this.accountOp!.gasFeePayment = this.#getGasFeePayment()
    }

    this.updateStatusToReadyToSign()
  }

  updateStatusToReadyToSign() {
    if (
      this.isInitialized &&
      this.#estimation &&
      this.accountOp?.signingKeyAddr &&
      this.accountOp?.gasFeePayment &&
      !this.errors.length
    ) {
      this.status = { type: SigningStatus.ReadyToSign }
    }
    this.emitUpdate()
  }

  reset() {
    this.#gasPrices = null
    this.#estimation = null
    this.selectedFeeSpeed = FeeSpeed.Fast
    this.paidBy = null
    this.selectedTokenAddr = null
    this.status = null
    this.humanReadable = []
    this.emitUpdate()
  }

  resetStatus() {
    this.status = null
    this.emitUpdate()
  }

  #getPortfolioToken(addr: string): TokenResult | undefined {
    return this.#portfolio.latest?.[this.accountOp!.accountAddr]?.[
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
   *
   * We require the ratio to be in a BigInt format since all the application values,
   * such as amount, gasLimit, etc., are also represented as BigInt numbers.
   */
  #getNativeToFeeTokenRatio(feeToken: TokenResult): bigint {
    const native = this.#getPortfolioToken('0x0000000000000000000000000000000000000000')
    const isUsd = (price: Price) => price.baseCurrency === 'usd'
    const ratio = native!.priceIn.find(isUsd)!.price / feeToken!.priceIn.find(isUsd)!.price

    // Here we multiply it by 1e18, in order to keep the decimal precision.
    // Otherwise, passing the ratio to the BigInt constructor, we will lose the numbers after the decimal point.
    // Later, once we need to normalize this ratio, we should not forget to divide it by 1e18.
    return BigInt(ratio * 1e18)
  }

  get feeSpeeds(): {
    type: string
    amount: bigint
    simulatedGasLimit: bigint
    amountFormatted: string
    amountUsd: string
  }[] {
    if (!this.isInitialized || !this.#gasPrices || !this.paidBy || !this.selectedTokenAddr)
      return []

    const gasUsed = this.#estimation!.gasUsed
    const feeToken = this.#getPortfolioToken(this.selectedTokenAddr)

    return this.#gasPrices.map((gasRecommendation) => {
      let amount
      let simulatedGasLimit

      let gasPrice = 0n
      // As GasRecommendation type is a result of the union between GasPriceRecommendation and Gas1559Recommendation,
      // then the both types don't have the same interface/props.
      // Therefore, we need to check for a prop existence, before accessing it.
      // GasPriceRecommendation
      if ('gasPrice' in gasRecommendation) gasPrice = gasRecommendation.gasPrice
      // Gas1559Recommendation
      if ('baseFeePerGas' in gasRecommendation)
        gasPrice = gasRecommendation.baseFeePerGas + gasRecommendation.maxPriorityFeePerGas

      // EOA
      if (!this.#account || !this.#account?.creation) {
        simulatedGasLimit = gasUsed
        amount = simulatedGasLimit * gasPrice + this.#estimation!.addedNative
      } else if (this.paidBy !== this.accountOp!.accountAddr) {
        // Smart account, but EOA pays the fee
        // @TODO - add comment why we add 21k gas here
        simulatedGasLimit = gasUsed + 21000n
        amount = simulatedGasLimit * gasPrice + this.#estimation!.addedNative
      } else {
        // Relayer.
        // relayer or 4337, we need to add feeTokenOutome.gasUsed
        const nativeRatio = this.#getNativeToFeeTokenRatio(feeToken!)
        const feeTokenGasUsed = this.#estimation!.feePaymentOptions.find(
          (option) => option.address === feeToken?.address
        )!.gasUsed!
        // @TODO - add comment why here we use `feePaymentOptions`, but we don't use it in EOA
        simulatedGasLimit = gasUsed + feeTokenGasUsed + 21000n

        const amountInWei = simulatedGasLimit * gasPrice + this.#estimation!.addedNative

        // Let's break down the process of converting the amount into FeeToken:
        // 1. Initially, we multiply the amount in wei by the native to fee token ratio.
        // 2. Next, we address the decimal places:
        // 2.1. First, we convert wei to native by dividing by 10^18 (representing the decimals).
        // 2.2. Now, with the amount in the native token, we incorporate nativeRatio decimals into the calculation (18 + 18) to standardize the amount.
        // 2.3. At this point, we precisely determine the number of fee tokens. For instance, if the amount is 3 USDC, we must convert it to a BigInt value, while also considering feeToken.decimals.
        amount = (amountInWei * nativeRatio) / BigInt(10 ** (18 + 18 - feeToken!.decimals))
      }

      return {
        type: gasRecommendation.name,
        simulatedGasLimit,
        amount,
        // TODO - fix type Number(feeToken?.decimals)
        amountFormatted: ethers.formatUnits(amount, Number(feeToken?.decimals)),
        amountUsd: getTokenUsdAmount(feeToken!, amount)
      }
    })
  }

  #getGasFeePayment(): GasFeePayment | null {
    if (!this.isInitialized) {
      this.emitError({
        level: 'major',
        message:
          'Something went wrong while setting up the gas fee payment account and token. Please try again, selecting the account and token option. If the problem persists, contact support.',
        error: new Error(
          'SignAccountOpController: The controller is not initialized while we are trying to build GasFeePayment.'
        )
      })

      return null
    }

    // Emitting silent errors for both `selectedTokenAddr` and `paidBy`
    // since we already validated for both fields in `update` method before calling #getGasFeePayment
    if (!this.selectedTokenAddr) {
      this.emitError({
        level: 'silent',
        message: '',
        error: new Error('SignAccountOpController: token not selected')
      })

      return null
    }
    if (!this.paidBy) {
      this.emitError({
        level: 'silent',
        message: '',
        error: new Error('SignAccountOpController: paying account not selected')
      })

      return null
    }

    const feeToken = this.#getPortfolioToken(this.selectedTokenAddr)
    const { amount, simulatedGasLimit } = this.feeSpeeds.find(
      (speed) => speed.type === this.selectedFeeSpeed
    )!

    return {
      paidBy: this.paidBy,
      isERC4337: false,
      isGasTank: feeToken?.networkId === 'gasTank',
      inToken: feeToken!.address,
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
    if (!this.isInitialized) return []

    // FeeOptions having amount
    return this.#estimation!.feePaymentOptions.filter((feeOption) => feeOption.availableAmount)
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
    if (!this.accountOp?.signingKeyAddr || !this.accountOp?.signingKeyType)
      return this.#setSigningError('We cannot sign your transaction. Please choose a signer.')

    if (!this.accountOp?.gasFeePayment)
      return this.#setSigningError('Please select a token and an account for paying the gas fee.')

    // This error should never happen, as we already validated the mandatory fields such as signingKeyAddr and signingKeyType, and gasFeePayment.
    if (!this.readyToSign)
      return this.#setSigningError(
        'We are unable to sign your transaction as some of the mandatory signing fields have not been set.'
      )

    const signer = await this.#keystore.getSigner(
      this.accountOp.signingKeyAddr,
      this.accountOp.signingKeyType
    )
    if (!signer) return this.#setSigningError('no available signer')

    this.status = { type: SigningStatus.InProgress }
    this.emitUpdate()

    const gasFeePayment = this.accountOp.gasFeePayment

    const provider = this.#providers[this.accountOp.networkId]
    const nonce = await provider.getTransactionCount(this.accountOp.accountAddr)
    try {
      // In case of EOA account
      if (!this.#account.creation) {
        if (this.accountOp.calls.length !== 1)
          return this.#setSigningError(
            'Tried to sign an EOA transaction with multiple or zero calls.'
          )
        const { to, value, data } = this.accountOp.calls[0]
        this.accountOp.signature = await signer.signRawTransaction({
          to,
          value,
          data,
          chainId: this.#network.chainId,
          gasLimit: gasFeePayment.simulatedGasLimit,
          nonce,
          gasPrice:
            (gasFeePayment.amount - this.#estimation!.addedNative) / gasFeePayment.simulatedGasLimit
        })
      } else if (this.accountOp.gasFeePayment.paidBy !== this.#account.addr) {
        // Smart account, but EOA pays the fee
        // EOA pays for execute() - relayerless

        this.accountOp.signature = wrapEthSign(
          await signer.signMessage(ethers.hexlify(accountOpSignableHash(this.accountOp)))
        )
      } else if (this.accountOp.gasFeePayment.isERC4337) {
        // TODO:
        // transform accountOp to userOperation
        // sign it
      } else {
        // Relayer

        // In case of gas tank token fee payment, we need to include one more call to account op
        const abiCoder = new ethers.AbiCoder()
        const feeCollector = '0x942f9CE5D9a33a82F88D233AEb3292E680230348'
        if (this.accountOp.gasFeePayment.isGasTank) {
          // @TODO - config/const
          const feeToken = this.#getPortfolioToken(this.accountOp.gasFeePayment.inToken)

          this.accountOp.feeCall = {
            to: feeCollector,
            value: 0n,
            data: abiCoder.encode(
              ['string', 'uint256', 'string'],
              ['gasTank', this.accountOp.gasFeePayment.amount, feeToken?.symbol]
            )
          }
        } else if (this.accountOp.gasFeePayment.inToken) {
          // TODO: add the fee payment only if it hasn't been added already
          if (
            this.accountOp.gasFeePayment.inToken === '0x0000000000000000000000000000000000000000'
          ) {
            // native payment
            this.accountOp.feeCall = {
              to: feeCollector,
              value: this.accountOp.gasFeePayment.amount,
              data: '0x'
            }
          } else {
            // token payment
            const ERC20Interface = new ethers.Interface(ERC20.abi)
            this.accountOp.feeCall = {
              to: this.accountOp.gasFeePayment.inToken,
              value: 0n,
              data: ERC20Interface.encodeFunctionData('transfer', [
                feeCollector,
                this.accountOp.gasFeePayment.amount
              ])
            }
          }
        }

        this.accountOp.signature = wrapEthSign(
          await signer.signMessage(ethers.hexlify(accountOpSignableHash(this.accountOp)))
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
      feeSpeeds: this.feeSpeeds,
      feeToken: this.feeToken,
      feePaidBy: this.feePaidBy,
      speedOptions: this.speedOptions,
      errors: this.errors
    }
  }
}
