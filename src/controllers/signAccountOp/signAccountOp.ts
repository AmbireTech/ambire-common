import { ethers, JsonRpcProvider } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import EntryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import ERC20 from '../../../contracts/compiled/IERC20.json'
import { AMBIRE_PAYMASTER, ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Account, AccountStates } from '../../interfaces/account'
import { ExternalSignerController, Key } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { getKnownAddressLabels } from '../../libs/account/account'
import {
  AccountOp,
  accountOpSignableHash,
  GasFeePayment,
  getSignableCalls
} from '../../libs/accountOp/accountOp'
import { EstimateResult } from '../../libs/estimate/estimate'
import { GasRecommendation, getCallDataAdditional } from '../../libs/gasPrice/gasPrice'
import { callsHumanizer } from '../../libs/humanizer'
import { IrCall } from '../../libs/humanizer/interfaces'
import { Price, TokenResult } from '../../libs/portfolio'
import { getTypedData, wrapStandard } from '../../libs/signMessage/signMessage'
import {
  getOneTimeNonce,
  isErc4337Broadcast,
  shouldUseOneTimeNonce,
  shouldUsePaymaster
} from '../../libs/userOperation/userOperation'
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

export class SignAccountOpController extends EventEmitter {
  #keystore: KeystoreController

  #portfolio: PortfolioController

  #settings: SettingsController

  #storage: Storage

  #fetch: Function

  #providers: { [key: string]: JsonRpcProvider }

  #account: Account

  #accounts: Account[]

  #accountStates: AccountStates

  #network: NetworkDescriptor

  accountOp: AccountOp

  #gasPrices: GasRecommendation[] | null = null

  #estimation: EstimateResult | null = null

  paidBy: string | null = null

  selectedTokenAddr: string | null = null

  selectedFeeSpeed: FeeSpeed = FeeSpeed.Fast

  humanReadable: IrCall[] = []

  status: Status | null = null

  #callRelayer: Function

  constructor(
    keystore: KeystoreController,
    portfolio: PortfolioController,
    settings: SettingsController,
    account: Account,
    accounts: Account[],
    accountStates: AccountStates,
    network: NetworkDescriptor,
    accountOp: AccountOp,
    storage: Storage,
    fetch: Function,
    providers: { [key: string]: JsonRpcProvider },
    callRelayer: Function
  ) {
    super()
    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#settings = settings
    this.#account = account
    this.#accounts = accounts
    this.#accountStates = accountStates
    this.#network = network
    this.accountOp = accountOp
    this.#storage = storage
    this.#fetch = fetch
    this.#providers = providers
    this.#callRelayer = callRelayer

    this.#humanizeAccountOp()
  }

  get isInitialized(): boolean {
    return !!(this.#account && this.#network && this.accountOp && this.#estimation)
  }

  #setDefaults() {
    if (this.availableFeeOptions.length && !this.paidBy && !this.selectedTokenAddr) {
      const defaultFeeOption = this.availableFeeOptions[0]

      this.paidBy = defaultFeeOption.paidBy
      this.selectedTokenAddr = defaultFeeOption.address
    }
    // Set the first signer as the default one.
    // If there are more available signers, the user will be able to select a different signer from the application.
    // The main benefit of having a default signer
    // is that it drastically simplifies the logic of determining whether the account is ready for signing.
    // For example, in the `sign` method and on the application screen, we can simply rely on the `this.readyToSign` flag.
    // Otherwise, if we don't have a default value, then `this.readyToSign` will always be false unless we set a signer.
    // In that case, on the application, we want the "Sign" button to be clickable/enabled,
    // and we have to check and expose the `SignAccountOp` controller's inner state to make this check possible.
    if (!this.accountOp.signingKeyAddr || !this.accountOp.signingKeyType) {
      this.accountOp.signingKeyAddr = this.accountKeyStoreKeys[0].addr
      this.accountOp.signingKeyType = this.accountKeyStoreKeys[0].type
    }
  }

  #setGasFeePayment() {
    if (this.isInitialized && this.paidBy && this.selectedTokenAddr && this.selectedFeeSpeed) {
      this.accountOp!.gasFeePayment = this.#getGasFeePayment()
    }
  }

  #humanizeAccountOp() {
    const knownAddressLabels = getKnownAddressLabels(
      this.#accounts,
      this.#settings.accountPreferences,
      this.#keystore.keys,
      this.#settings.keyPreferences
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

  get errors(): string[] {
    const errors: string[] = []

    if (!this.isInitialized) return errors

    if (!this.availableFeeOptions.length)
      errors.push(
        "We are unable to estimate your transaction as you don't have tokens with balances to cover the fee."
      )

    if (!this.accountKeyStoreKeys.length)
      errors.push('We are unable to sign your transaction as there is no available signer.')

    // This error should not happen, as in the update method we are always setting a default signer.
    // It may occur, only if there are no available signer.
    if (!this.accountOp?.signingKeyType || !this.accountOp?.signingKeyAddr)
      errors.push('Please select a signer to sign the transaction.')

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

    // The signing might fail, tell the user why but allow the user to retry signing,
    // @ts-ignore fix TODO: type mismatch
    if (this.status?.type === SigningStatus.ReadyToSign && !!this.status.error) {
      // @ts-ignore typescript complains, but the error being present gets checked above
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

    // Set defaults, if some of the optional params are omitted
    this.#setDefaults()
    // Here, we expect to have most of the fields set, so we can safely set GasFeePayment
    this.#setGasFeePayment()
    this.updateStatusToReadyToSign()
  }

  updateStatusToReadyToSign() {
    if (
      this.isInitialized &&
      this.#estimation &&
      this.accountOp?.signingKeyAddr &&
      this.accountOp?.signingKeyType &&
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

  static getAmountAfterFeeTokenConvert(
    simulatedGasLimit: bigint,
    gasPrice: bigint,
    nativeRatio: bigint,
    feeTokenDecimals: number,
    addedNative: bigint
  ) {
    const amountInWei = simulatedGasLimit * gasPrice + addedNative

    // Let's break down the process of converting the amount into FeeToken:
    // 1. Initially, we multiply the amount in wei by the native to fee token ratio.
    // 2. Next, we address the decimal places:
    // 2.1. First, we convert wei to native by dividing by 10^18 (representing the decimals).
    // 2.2. Now, with the amount in the native token, we incorporate nativeRatio decimals into the calculation (18 + 18) to standardize the amount.
    // 2.3. At this point, we precisely determine the number of fee tokens. For instance, if the amount is 3 USDC, we must convert it to a BigInt value, while also considering feeToken.decimals.
    const extraDecimals = BigInt(10 ** 18)
    const feeTokenDecimalsInWei = BigInt(10 ** (18 - feeTokenDecimals))
    const pow = extraDecimals * feeTokenDecimalsInWei
    return (amountInWei * nativeRatio) / pow
  }

  /**
   * Increase the fee we send to the feeCollector according to the specified
   * options in the network tab
   */
  #increaseFee(amount: bigint): bigint {
    if (!this.#network.feeOptions.feeIncrease) {
      return amount
    }

    return amount + (amount * this.#network.feeOptions.feeIncrease) / 100n
  }

  get feeSpeeds(): {
    type: string
    amount: bigint
    simulatedGasLimit: bigint
    amountFormatted: string
    amountUsd: string
    maxPriorityFeePerGas?: bigint
  }[] {
    if (!this.isInitialized || !this.#gasPrices || !this.paidBy || !this.selectedTokenAddr)
      return []

    const gasUsed = this.#estimation!.gasUsed
    const feeToken = this.#getPortfolioToken(this.selectedTokenAddr)
    const feeTokenEstimation = this.#estimation!.feePaymentOptions.find(
      (option) => option.address === this.selectedTokenAddr && this.paidBy === option.paidBy
    )!

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
        amount = simulatedGasLimit * gasPrice + feeTokenEstimation.addedNative
      } else if (this.#estimation!.erc4337estimation) {
        // ERC 4337
        const nativeRatio = this.#getNativeToFeeTokenRatio(feeToken!)

        simulatedGasLimit =
          this.#estimation!.erc4337estimation.gasUsed + feeTokenEstimation.gasUsed!
        amount = SignAccountOpController.getAmountAfterFeeTokenConvert(
          simulatedGasLimit,
          gasPrice,
          nativeRatio,
          feeToken!.decimals,
          feeTokenEstimation.addedNative
        )
        if (shouldUsePaymaster(this.accountOp.asUserOperation!, feeToken!.address)) {
          amount = this.#increaseFee(amount)
        }
      } else if (this.paidBy !== this.accountOp!.accountAddr) {
        // Smart account, but EOA pays the fee
        simulatedGasLimit = gasUsed

        const accountState =
          this.#accountStates![this.accountOp!.accountAddr][this.accountOp!.networkId]
        simulatedGasLimit += getCallDataAdditional(this.accountOp!, this.#network, accountState)

        amount = simulatedGasLimit * gasPrice + feeTokenEstimation.addedNative
      } else {
        // Relayer.
        // relayer or 4337, we need to add feeTokenOutome.gasUsed
        const nativeRatio = this.#getNativeToFeeTokenRatio(feeToken!)
        const feeTokenGasUsed = this.#estimation!.feePaymentOptions.find(
          (option) => option.address === feeToken?.address
        )!.gasUsed!
        // @TODO - add comment why here we use `feePaymentOptions`, but we don't use it in EOA
        simulatedGasLimit = gasUsed + feeTokenGasUsed

        const accountState =
          this.#accountStates![this.accountOp!.accountAddr][this.accountOp!.networkId]
        simulatedGasLimit += getCallDataAdditional(this.accountOp!, this.#network, accountState)

        amount = SignAccountOpController.getAmountAfterFeeTokenConvert(
          simulatedGasLimit,
          gasPrice,
          nativeRatio,
          feeToken!.decimals,
          feeTokenEstimation.addedNative
        )
        amount = this.#increaseFee(amount)
      }

      const fee: any = {
        type: gasRecommendation.name,
        simulatedGasLimit,
        amount,
        // TODO - fix type Number(feeToken?.decimals)
        amountFormatted: ethers.formatUnits(amount, Number(feeToken?.decimals)),
        amountUsd: getTokenUsdAmount(feeToken!, amount)
      }

      if ('maxPriorityFeePerGas' in gasRecommendation) {
        fee.maxPriorityFeePerGas = gasRecommendation.maxPriorityFeePerGas
      }

      return fee
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
    const chosenSpeed = this.feeSpeeds.find((speed) => speed.type === this.selectedFeeSpeed)!

    const accountState =
      this.#accountStates![this.accountOp!.accountAddr][this.accountOp!.networkId]
    const gasFeePayment: GasFeePayment = {
      paidBy: this.paidBy,
      isERC4337: isErc4337Broadcast(this.#network, accountState),
      isGasTank: feeToken?.networkId === 'gasTank',
      inToken: feeToken!.address,
      amount: chosenSpeed.amount,
      simulatedGasLimit: chosenSpeed.simulatedGasLimit
    }

    if (chosenSpeed.maxPriorityFeePerGas) {
      gasFeePayment.maxPriorityFeePerGas = chosenSpeed.maxPriorityFeePerGas
    }

    return gasFeePayment
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

  get accountKeyStoreKeys(): Key[] {
    return this.#keystore.keys.filter((key) => this.#account?.associatedKeys.includes(key.addr))
  }

  // eslint-disable-next-line class-methods-use-this
  get speedOptions() {
    return Object.values(FeeSpeed) as string[]
  }

  #setSigningError(error: string, type = SigningStatus.UnableToSign) {
    this.status = { type, error }
    this.emitUpdate()
  }

  #addFeePayment() {
    // In case of gas tank token fee payment, we need to include one more call to account op
    const abiCoder = new ethers.AbiCoder()
    const feeCollector = '0x942f9CE5D9a33a82F88D233AEb3292E680230348'

    if (this.accountOp!.gasFeePayment!.isGasTank) {
      // @TODO - config/const
      const feeToken = this.#getPortfolioToken(this.accountOp!.gasFeePayment!.inToken)

      this.accountOp!.feeCall = {
        to: feeCollector,
        value: 0n,
        data: abiCoder.encode(
          ['string', 'uint256', 'string'],
          ['gasTank', this.accountOp!.gasFeePayment!.amount, feeToken?.symbol]
        )
      }

      return
    }

    if (this.accountOp!.gasFeePayment!.inToken === '0x0000000000000000000000000000000000000000') {
      // native payment
      this.accountOp!.feeCall = {
        to: feeCollector,
        value: this.accountOp!.gasFeePayment!.amount,
        data: '0x'
      }
    } else {
      // token payment
      const ERC20Interface = new ethers.Interface(ERC20.abi)
      this.accountOp!.feeCall = {
        to: this.accountOp!.gasFeePayment!.inToken,
        value: 0n,
        data: ERC20Interface.encodeFunctionData('transfer', [
          feeCollector,
          this.accountOp!.gasFeePayment!.amount
        ])
      }
    }
  }

  async sign(externalSignerController?: ExternalSignerController) {
    if (!this.accountOp?.signingKeyAddr || !this.accountOp?.signingKeyType)
      return this.#setSigningError('We cannot sign your transaction. Please choose a signer key.')

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

    if (signer.init) signer.init(externalSignerController)
    const provider = this.#providers[this.accountOp.networkId]
    try {
      // In case of EOA account
      if (!this.#account.creation) {
        if (this.accountOp.calls.length !== 1)
          return this.#setSigningError(
            'Tried to sign an EOA transaction with multiple or zero calls.'
          )

        // In legacy mode, we sign the transaction directly.
        // that means the signing will happen on broadcast and here
        // checking whether the call is 1 and 1 only is enough
        this.accountOp.signature = '0x'
      } else if (this.accountOp.gasFeePayment.paidBy !== this.#account.addr) {
        // Smart account, but EOA pays the fee
        // EOA pays for execute() - relayerless

        const typedData = getTypedData(
          this.#network.chainId,
          this.accountOp.accountAddr,
          ethers.hexlify(accountOpSignableHash(this.accountOp))
        )
        this.accountOp.signature = wrapStandard(await signer.signTypedData(typedData))
      } else if (this.accountOp.gasFeePayment.isERC4337) {
        const userOperation = this.accountOp.asUserOperation
        if (!userOperation) {
          return this.#setSigningError(
            `Cannot sign as no user operation is present foxr account op ${this.accountOp.accountAddr}`
          )
        }

        // set as maxFeePerGas only the L2 gas price
        const feeTokenEstimation = this.#estimation!.feePaymentOptions.find(
          (option) => option.address === this.selectedTokenAddr && this.paidBy === option.paidBy
        )!
        let amountInWei = gasFeePayment.amount
        const feeToken = this.#getPortfolioToken(this.selectedTokenAddr!)
        if (feeToken?.address !== '0x0000000000000000000000000000000000000000') {
          const nativeRatio = this.#getNativeToFeeTokenRatio(feeToken!)
          amountInWei =
            (gasFeePayment.amount * BigInt(10 ** (18 + 18 - feeToken!.decimals))) / nativeRatio
        }
        const gasPrice =
          (amountInWei - feeTokenEstimation.addedNative) / gasFeePayment.simulatedGasLimit
        userOperation.maxFeePerGas = ethers.toBeHex(gasPrice)
        userOperation.maxPriorityFeePerGas = ethers.toBeHex(gasFeePayment.maxPriorityFeePerGas!)

        const usesOneTimeNonce = shouldUseOneTimeNonce(userOperation)
        const usesPaymaster = shouldUsePaymaster(
          userOperation,
          this.accountOp.gasFeePayment.inToken
        )

        if (usesPaymaster) {
          this.#addFeePayment()
        } else {
          delete this.accountOp.feeCall
        }

        const ambireAccount = new ethers.Interface(AmbireAccount.abi)
        if (usesOneTimeNonce) {
          const typedData = getTypedData(
            this.#network.chainId,
            this.accountOp.accountAddr,
            ethers.hexlify(accountOpSignableHash(this.accountOp))
          )
          const signature = wrapStandard(await signer.signTypedData(typedData))
          userOperation.callData = ambireAccount.encodeFunctionData('executeMultiple', [
            [[getSignableCalls(this.accountOp), signature]]
          ])
          this.accountOp.signature = signature
        } else {
          userOperation.callData = ambireAccount.encodeFunctionData('executeBySender', [
            getSignableCalls(this.accountOp)
          ])
        }

        if (usesPaymaster) {
          try {
            const response = await this.#callRelayer(
              `/v2/paymaster/${this.accountOp.networkId}/sign`,
              'POST',
              {
                // send without the requestType prop
                userOperation: (({ requestType, activatorCall, ...o }) => o)(userOperation),
                paymaster: AMBIRE_PAYMASTER
              }
            )
            userOperation.paymasterAndData = response.data.paymasterAndData
            if (usesOneTimeNonce) {
              userOperation.nonce = getOneTimeNonce(userOperation)
            }
          } catch (e: any) {
            return this.#setSigningError(e.message)
          }
        }

        if (userOperation.requestType === 'standard') {
          const entryPoint: any = new ethers.BaseContract(
            ERC_4337_ENTRYPOINT,
            EntryPointAbi,
            provider
          )
          const typedData = getTypedData(
            this.#network.chainId,
            this.accountOp.accountAddr,
            await entryPoint.getUserOpHash(userOperation)
          )
          const signature = wrapStandard(await signer.signTypedData(typedData))
          userOperation.signature = signature
          this.accountOp.signature = signature
        }
        this.accountOp.asUserOperation = userOperation
      } else {
        // Relayer
        this.#addFeePayment()
        const typedData = getTypedData(
          this.#network.chainId,
          this.accountOp.accountAddr,
          ethers.hexlify(accountOpSignableHash(this.accountOp))
        )
        this.accountOp.signature = wrapStandard(await signer.signTypedData(typedData))
      }

      this.status = { type: SigningStatus.Done }
      this.emitUpdate()
    } catch (error: any) {
      this.#setSigningError(error?.message, SigningStatus.ReadyToSign)
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
      accountKeyStoreKeys: this.accountKeyStoreKeys,
      feeSpeeds: this.feeSpeeds,
      feeToken: this.feeToken,
      feePaidBy: this.feePaidBy,
      speedOptions: this.speedOptions,
      errors: this.errors
    }
  }
}
