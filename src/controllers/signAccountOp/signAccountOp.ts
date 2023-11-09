import { ethers, JsonRpcProvider } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { Account, AccountStates } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { AccountOp, accountOpSignableHash, GasFeePayment, getSignableCalls, isNative } from '../../libs/accountOp/accountOp'
import { EstimateResult } from '../../libs/estimate/estimate'
import { GasRecommendation, getCallDataAdditional } from '../../libs/gasPrice/gasPrice'
import { callsHumanizer } from '../../libs/humanizer'
import { IrCall } from '../../libs/humanizer/interfaces'
import { Price, TokenResult } from '../../libs/portfolio'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import { getTargetEdgeCaseNonce } from '../../libs/userOperation/userOperation'
import EntryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'

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

  #callRelayer: Function

  constructor(
    keystore: KeystoreController,
    portfolio: PortfolioController,
    storage: Storage,
    fetch: Function,
    providers: { [key: string]: JsonRpcProvider },
    callRelayer: Function
  ) {
    super()

    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#storage = storage
    this.#fetch = fetch
    this.#providers = providers
    this.#callRelayer = callRelayer
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
        [],
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

  #getAmountAfterFeeTokenConvert(
    simulatedGasLimit: bigint,
    gasPrice: bigint,
    nativeRatio: bigint,
    feeTokenDecimals: number
  ) {
    const amountInWei = simulatedGasLimit * gasPrice + this.#estimation!.addedNative

    // Let's break down the process of converting the amount into FeeToken:
    // 1. Initially, we multiply the amount in wei by the native to fee token ratio.
    // 2. Next, we address the decimal places:
    // 2.1. First, we convert wei to native by dividing by 10^18 (representing the decimals).
    // 2.2. Now, with the amount in the native token, we incorporate nativeRatio decimals into the calculation (18 + 18) to standardize the amount.
    // 2.3. At this point, we precisely determine the number of fee tokens. For instance, if the amount is 3 USDC, we must convert it to a BigInt value, while also considering feeToken.decimals.
    return (amountInWei * nativeRatio) / BigInt(10 ** (18 + 18 - feeTokenDecimals))
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
    const network = this.#networks?.find((n) => n.id === this.accountOp?.networkId)

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
      } else if (this.#estimation!.erc4337estimation) {
        // ERC 4337
        const nativeRatio = this.#getNativeToFeeTokenRatio(feeToken!)
        const feeTokenGasUsed = this.#estimation!.feePaymentOptions.find(
          (option) => option.address === feeToken?.address
        )!.gasUsed!

        simulatedGasLimit = this.#estimation!.erc4337estimation.gasUsed + feeTokenGasUsed
        amount = this.#getAmountAfterFeeTokenConvert(simulatedGasLimit, gasPrice, nativeRatio, feeToken!.decimals)

        const maxFeePerGas = (amount - this.#estimation!.addedNative) / simulatedGasLimit
        this.accountOp!.asUserOperation!.maxFeePerGas = ethers.toBeHex(maxFeePerGas)
        this.accountOp!.asUserOperation!.maxPriorityFeePerGas = ethers.toBeHex(maxFeePerGas)
      } else if (this.paidBy !== this.accountOp!.accountAddr) {
        // Smart account, but EOA pays the fee
        simulatedGasLimit = gasUsed

        const accountState = this.#accountStates![this.accountOp!.accountAddr][this.accountOp!.networkId]
        simulatedGasLimit += getCallDataAdditional(this.accountOp!, network!, accountState.isDeployed)

        amount = simulatedGasLimit * gasPrice + this.#estimation!.addedNative
      } else {
        // Relayer.
        // relayer or 4337, we need to add feeTokenOutome.gasUsed
        const nativeRatio = this.#getNativeToFeeTokenRatio(feeToken!)
        const feeTokenGasUsed = this.#estimation!.feePaymentOptions.find(
          (option) => option.address === feeToken?.address
        )!.gasUsed!
        // @TODO - add comment why here we use `feePaymentOptions`, but we don't use it in EOA
        simulatedGasLimit = gasUsed + feeTokenGasUsed

        const accountState = this.#accountStates![this.accountOp!.accountAddr][this.accountOp!.networkId]
        simulatedGasLimit += getCallDataAdditional(this.accountOp!, network!, accountState.isDeployed)

        amount = this.#getAmountAfterFeeTokenConvert(simulatedGasLimit, gasPrice, nativeRatio, feeToken!.decimals)
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

    const network = this.#networks?.find((n) => n.id === this.accountOp?.networkId)
    return {
      paidBy: this.paidBy,
      isERC4337: network?.erc4337?.enabled ?? false,
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

  #addFeePayment() {
    // TODO: add the fee payment only if it hasn't been added already

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

    if (this.accountOp!.gasFeePayment!.inToken == '0x0000000000000000000000000000000000000000') {
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
        const userOperation = this.accountOp.asUserOperation
        if (!userOperation) {
          return this.#setSigningError(
            `Cannot sign as no user operation is present foxr account op ${this.accountOp.accountAddr}`
          )
        }
        if (userOperation?.isEdgeCase || !isNative(this.accountOp.gasFeePayment)) {
          this.#addFeePayment()
        } else {
          delete this.accountOp.feeCall
        }

        // if we're in the edge case scenario, set the callData to
        // executeMultiple and sign it
        if (userOperation.isEdgeCase) {
          const ambireAccount = new ethers.Interface(AmbireAccount.abi)
          const signature = wrapEthSign(
            await signer.signMessage(ethers.hexlify(accountOpSignableHash(this.accountOp)))
          )
          userOperation.callData = ambireAccount.encodeFunctionData('executeMultiple', [[[
            getSignableCalls(this.accountOp),
            signature
          ]]])
          this.accountOp.signature = signature
        }

        // call the paymaster for the edgeCase or for non-native payments
        if (
          userOperation.isEdgeCase ||
          !isNative(this.accountOp.gasFeePayment!)
        ) {
          const response = await this.#callRelayer(
            `/v2/paymaster/${this.accountOp.networkId}/sign`,
            'POST',
            // send without the isEdgeCase prop
            {userOperation: (({ isEdgeCase, ...o }) => o)(userOperation)}
          )
          if (response.success) {
            userOperation.paymasterAndData = response.data.paymasterAndData

            // after getting the paymaster data, if we're in the edge case,
            // we have to set the correct edge case nonce
            if (userOperation.isEdgeCase) {
              userOperation.nonce = getTargetEdgeCaseNonce(userOperation)
            }
          } else {
            this.#setSigningError(`User operation signing failed on paymaster approval: ${response.data.errorState}`)
          }
        }

        // in normal cases (not edgeCase), we sign the user operation
        if (!userOperation.isEdgeCase) { 
          const entryPoint: any = new ethers.BaseContract(ERC_4337_ENTRYPOINT, EntryPointAbi, provider)
          const userOpHash = await entryPoint.getUserOpHash(userOperation)
          const signature = wrapEthSign(await signer.signMessage(userOpHash))
          userOperation.signature = signature
          this.accountOp.signature = signature
        }
        this.accountOp.asUserOperation = userOperation
      } else {
        // Relayer
        this.#addFeePayment()
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
