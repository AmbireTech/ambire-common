import { ethers, JsonRpcProvider } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { Account, AccountStates } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { AccountOp, accountOpSignableHash, GasFeePayment } from '../../libs/accountOp/accountOp'
import { EstimateResult } from '../../libs/estimate/estimate'
import { GasRecommendation } from '../../libs/gasPrice/gasPrice'
import { callsHumanizer } from '../../libs/humanizer'
import { getKnownAddressLabels } from '../../libs/humanizer/humanizerFuncs'
import { IrCall } from '../../libs/humanizer/interfaces'
import { Price, TokenResult } from '../../libs/portfolio'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import { SettingsController } from '../settings/settings'

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

  #settings: SettingsController

  #storage: Storage

  #fetch: Function

  #providers: { [key: string]: JsonRpcProvider }

  #accounts: Account[] | null = null

  #networks: NetworkDescriptor[] | null = null

  #accountStates: AccountStates | null = null

  accountOp: AccountOp | null = null

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
    settings: SettingsController,
    storage: Storage,
    fetch: Function,
    providers: { [key: string]: JsonRpcProvider }
  ) {
    super()

    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#settings = settings
    this.#storage = storage
    this.#fetch = fetch
    this.#providers = providers
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
    // TODO: fine-tune the error handling
    if (!this.#accounts) throw new Error('signAccountOp: accounts not set')

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

      const knownAddressLabels = getKnownAddressLabels(
        this.#accounts,
        this.#settings.accountPreferences
      )
      callsHumanizer(
        this.accountOp,
        knownAddressLabels,
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
    if (this.availableFeeOptions.length && !this.paidBy && !this.feeToken) {
      const defaultFeeOption = this.availableFeeOptions[0]

      this.paidBy = defaultFeeOption.paidBy
      this.selectedTokenAddr = defaultFeeOption.address
    }

    if (this.isInitialized && this.paidBy && this.selectedTokenAddr && this.selectedFeeSpeed) {
      this.accountOp!.gasFeePayment = this.#getGasFeePayment()
    }

    this.updateStatusToReadyToSign()
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

    this.updateStatusToReadyToSign()
  }

  updateStatusToReadyToSign() {
    if (
      this.isInitialized &&
      this.#estimation &&
      this.accountOp?.signingKeyAddr &&
      this.accountOp?.gasFeePayment
    ) {
      this.status = { type: SigningStatus.ReadyToSign }
    }
    this.emitUpdate()
  }

  reset() {
    this.accountOp = null
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

    const account = this.#getAccount()
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
      if (!account || !account?.creation) {
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

  #getGasFeePayment(): GasFeePayment {
    if (!this.isInitialized) throw new Error('signAccountOp: not initialized')

    if (!this.selectedTokenAddr) throw new Error('signAccountOp: token not selected')
    if (!this.paidBy) throw new Error('signAccountOp: paying account not selected')

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
    const account = this.#getAccount()
    if (!account || !this.isInitialized) return []

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
      return this.#setSigningError('no signing key set')
    if (!this.accountOp?.gasFeePayment) return this.#setSigningError('no gasFeePayment set')
    if (!this.readyToSign) return this.#setSigningError('not ready to sign')
    const network = this.#networks?.find((n) => n.id === this.accountOp?.networkId)
    if (!network) return this.#setSigningError('sign: unsupported network')

    const account = this.#getAccount()
    const signer = await this.#keystore.getSigner(
      this.accountOp.signingKeyAddr,
      this.accountOp.signingKeyType
    )
    if (!account) return this.#setSigningError('non-existent account')
    if (!signer) return this.#setSigningError('no available signer')

    this.status = { type: SigningStatus.InProgress }
    this.emitUpdate()

    const gasFeePayment = this.accountOp.gasFeePayment

    const provider = this.#providers[this.accountOp.networkId]
    const nonce = await provider.getTransactionCount(this.accountOp.accountAddr)
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
          chainId: network.chainId,
          gasLimit: gasFeePayment.simulatedGasLimit,
          nonce,
          gasPrice:
            (gasFeePayment.amount - this.#estimation!.addedNative) / gasFeePayment.simulatedGasLimit
        })
      } else if (this.accountOp.gasFeePayment.paidBy !== account.addr) {
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
            this.accountOp.gasFeePayment.inToken == '0x0000000000000000000000000000000000000000'
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
      speedOptions: this.speedOptions
    }
  }
}
