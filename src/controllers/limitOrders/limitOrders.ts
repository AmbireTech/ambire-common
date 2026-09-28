import { formatUnits, parseUnits } from 'ethers'

import { RecurringTimeout } from '@/classes/recurringTimeout/recurringTimeout'
import { STK_WALLET } from '@/consts/addresses'
import { IAccountsController } from '@/interfaces/account'
import { IActivityController } from '@/interfaces/activity'
import { IDappsController } from '@/interfaces/dapp'
import { IErc7730Controller } from '@/interfaces/erc7730'
import { IEventEmitterRegistryController } from '@/interfaces/eventEmitter'
import { IFeatureFlagsController } from '@/interfaces/featureFlags'
import { ExternalSignerControllers, IKeystoreController } from '@/interfaces/keystore'
import {
  LimitOrderFormStatus,
  LimitOrderData,
  LimitOrderMarketQuote,
  LimitOrderPlacementStatus,
  PreparedLimitOrder
} from '@/interfaces/limitOrders'
import { INetworksController } from '@/interfaces/network'
import { IPhishingController } from '@/interfaces/phishing'
import { IPortfolioController } from '@/interfaces/portfolio'
import { IProvidersController } from '@/interfaces/provider'
import { ISelectedAccountController } from '@/interfaces/selectedAccount'
import { ISignAccountOpController, SignAccountOpError } from '@/interfaces/signAccountOp'
import { SwapAndBridgeToToken } from '@/interfaces/swapAndBridge'
import { CallsUserRequest, UserRequest } from '@/interfaces/userRequest'
import { getBaseAccount } from '@/libs/account/getBaseAccount'
import { AccountOp } from '@/libs/accountOp/accountOp'
import { BindedRelayerCall } from '@/libs/relayerCall/relayerCall'
import { getAmbirePaymasterService } from '@/libs/erc7677/erc7677'
import { randomId } from '@/libs/humanizer/utils'
import { TokenResult } from '@/libs/portfolio'
import { getTokenAmount } from '@/libs/portfolio/helpers'
import { getFeePercentForStkWalletToken } from '@/libs/swapAndBridge/fee'
import {
  getApprovalAndActionCalls,
  getIsTokenEligibleForSwapAndBridge,
  sortPortfolioTokenList
} from '@/libs/swapAndBridge/swapAndBridge'
import { LimitOrderAPI } from '@/services/cowswap/limitOrderApi'
import { validateSendTransferAmount, Validation } from '@/services/validations/validate'
import { generateUuid } from '@/utils/uuid'

import { EstimationStatus } from '../estimation/types'
import EventEmitter from '../eventEmitter/eventEmitter'
import {
  OnBroadcastFailed,
  OnBroadcastSuccess,
  SignAccountOpController
} from '../signAccountOp/signAccountOp'
import { SignAccountOpPreferenceController } from '../signAccountOp/signAccountOpPreference'

const DEFAULT_EXPIRATION_SECONDS = 7 * 24 * 60 * 60
const ORDER_PLACEMENT_INTERVAL = 5000
const MAX_ORDER_PLACEMENT_ATTEMPTS = 60
const PRICE_DISPLAY_DECIMALS = 8

type UpdateForm = {
  expirationSeconds?: number
  fromAmount?: string
  fromSelectedToken?: TokenResult | null
  limitPrice?: string
  toSelectedToken?: SwapAndBridgeToToken | null
}

const sanitizeDecimalInput = (value: string) => {
  const [whole = '', ...fractionParts] = value.replace(',', '.').split('.')
  const sanitizedWhole = [...whole].filter((char) => char >= '0' && char <= '9').join('')
  const sanitizedFraction = [...fractionParts.join('')]
    .filter((char) => char >= '0' && char <= '9')
    .join('')

  return fractionParts.length ? `${sanitizedWhole || '0'}.${sanitizedFraction}` : sanitizedWhole
}

const formatPrice = ({
  buyAmount,
  sellAmount,
  buyDecimals,
  sellDecimals
}: {
  buyAmount: bigint
  sellAmount: bigint
  buyDecimals: number
  sellDecimals: number
}) => {
  if (sellAmount <= 0n) return ''

  const scaledPrice =
    (buyAmount * 10n ** BigInt(sellDecimals + PRICE_DISPLAY_DECIMALS)) /
    (sellAmount * 10n ** BigInt(buyDecimals))
  const formatted = formatUnits(scaledPrice, PRICE_DISPLAY_DECIMALS)
  const [whole = '0', fraction = ''] = formatted.split('.')
  let trimmedFraction = fraction
  while (trimmedFraction.endsWith('0')) trimmedFraction = trimmedFraction.slice(0, -1)
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole
}

/** Manages the same-network CoW limit-order form, review transaction, and order placement. */
export class LimitOrdersController extends EventEmitter {
  #api: LimitOrderAPI

  #accounts: IAccountsController

  #activity: IActivityController

  #callRelayer: BindedRelayerCall

  #dapps: IDappsController

  #erc7730: IErc7730Controller

  #externalSignerControllers: ExternalSignerControllers

  #featureFlags: IFeatureFlagsController

  #keystore: IKeystoreController

  #networks: INetworksController

  #onBroadcastFailed: OnBroadcastFailed

  #onBroadcastSuccess: OnBroadcastSuccess

  #phishing: IPhishingController

  #portfolio: IPortfolioController

  #providers: IProvidersController

  #relayerUrl: string

  #selectedAccount: ISelectedAccountController

  #signAccountOpController: SignAccountOpController | null = null

  #signAccountOpPreference: SignAccountOpPreferenceController

  #getUserRequests: () => UserRequest[]

  #prepareOrderId = ''

  #toTokenListId = ''

  #prepareOrderTimeout?: NodeJS.Timeout

  #placementAttempts = 0

  #placementId = ''

  #placementInterval: RecurringTimeout

  #isLimitPriceUserEdited = false

  sessionIds: string[] = []

  portfolioTokenList: TokenResult[] = []

  toTokenList: SwapAndBridgeToToken[] = []

  fromSelectedToken: TokenResult | null = null

  toSelectedToken: SwapAndBridgeToToken | null = null

  fromAmount = ''

  limitPrice = ''

  expirationSeconds = DEFAULT_EXPIRATION_SECONDS

  preparedOrder: PreparedLimitOrder | null = null

  marketQuote: LimitOrderMarketQuote | null = null

  prepareOrderStatus: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'ERROR' = 'INITIAL'

  toTokenListStatus: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'ERROR' = 'INITIAL'

  placementStatus: LimitOrderPlacementStatus = 'INITIAL'

  placementError = ''

  feePercent = 0.5

  hasProceeded = false

  constructor({
    eventEmitterRegistry,
    api,
    accounts,
    activity,
    callRelayer,
    dapps,
    erc7730,
    externalSignerControllers,
    featureFlags,
    keystore,
    networks,
    onBroadcastFailed,
    onBroadcastSuccess,
    phishing,
    portfolio,
    providers,
    relayerUrl,
    selectedAccount,
    signAccountOpPreference,
    getUserRequests
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    api: LimitOrderAPI
    accounts: IAccountsController
    activity: IActivityController
    callRelayer: BindedRelayerCall
    dapps: IDappsController
    erc7730: IErc7730Controller
    externalSignerControllers: ExternalSignerControllers
    featureFlags: IFeatureFlagsController
    keystore: IKeystoreController
    networks: INetworksController
    onBroadcastFailed: OnBroadcastFailed
    onBroadcastSuccess: OnBroadcastSuccess
    phishing: IPhishingController
    portfolio: IPortfolioController
    providers: IProvidersController
    relayerUrl: string
    selectedAccount: ISelectedAccountController
    signAccountOpPreference: SignAccountOpPreferenceController
    getUserRequests: () => UserRequest[]
  }) {
    super(eventEmitterRegistry)
    this.#api = api
    this.#accounts = accounts
    this.#activity = activity
    this.#callRelayer = callRelayer
    this.#dapps = dapps
    this.#erc7730 = erc7730
    this.#externalSignerControllers = externalSignerControllers
    this.#featureFlags = featureFlags
    this.#keystore = keystore
    this.#networks = networks
    this.#onBroadcastFailed = onBroadcastFailed
    this.#onBroadcastSuccess = onBroadcastSuccess
    this.#phishing = phishing
    this.#portfolio = portfolio
    this.#providers = providers
    this.#relayerUrl = relayerUrl
    this.#selectedAccount = selectedAccount
    this.#signAccountOpPreference = signAccountOpPreference
    this.#getUserRequests = getUserRequests
    this.#placementInterval = new RecurringTimeout(
      this.#tryPlaceOrder.bind(this),
      ORDER_PLACEMENT_INTERVAL,
      this.emitError.bind(this),
      'limit-order-placement'
    )

    this.#selectedAccount.onUpdate(() => {
      if (!this.sessionIds.length) return
      this.#syncPortfolioTokens()
      if (!this.fromSelectedToken && this.portfolioTokenList[0]) {
        this.fromSelectedToken = this.portfolioTokenList[0]
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#updateToTokenList()
      }
    }, 'limit-orders')
  }

  #syncPortfolioTokens() {
    const supportedChainIds = this.#api.getSupportedChains().map(({ chainId }) => BigInt(chainId))
    this.portfolioTokenList = sortPortfolioTokenList(
      this.#selectedAccount.portfolio.tokens.filter(
        (token) =>
          supportedChainIds.includes(token.chainId) && getIsTokenEligibleForSwapAndBridge(token)
      )
    )
    const stkWalletToken = this.#selectedAccount.portfolio.tokens.find(
      (token) => token.chainId === 1n && token.address.toLowerCase() === STK_WALLET.toLowerCase()
    )
    this.feePercent = getFeePercentForStkWalletToken(stkWalletToken)

    if (this.fromSelectedToken) {
      this.fromSelectedToken =
        this.portfolioTokenList.find(
          (token) =>
            token.address.toLowerCase() === this.fromSelectedToken?.address.toLowerCase() &&
            token.chainId === this.fromSelectedToken.chainId
        ) || this.fromSelectedToken
    }

    this.emitUpdate()
  }

  async initForm(sessionId: string) {
    if (!this.#featureFlags.isFeatureEnabled('limitOrders')) return
    if (!this.sessionIds.includes(sessionId)) this.sessionIds.push(sessionId)
    this.#syncPortfolioTokens()

    if (!this.fromSelectedToken && this.portfolioTokenList[0]) {
      this.fromSelectedToken = this.portfolioTokenList[0]
      await this.#updateToTokenList()
    }

    this.emitUpdate()
  }

  unloadScreen(sessionId: string) {
    this.sessionIds = this.sessionIds.filter((id) => id !== sessionId)
    if (!this.sessionIds.length) this.#clearPrepareOrderTimeout()
    this.emitUpdate()
  }

  #clearPrepareOrderTimeout() {
    if (!this.#prepareOrderTimeout) return
    clearTimeout(this.#prepareOrderTimeout)
    this.#prepareOrderTimeout = undefined
  }

  async #updateToTokenList() {
    if (!this.fromSelectedToken) return
    const requestId = generateUuid()
    this.#toTokenListId = requestId
    const chainId = Number(this.fromSelectedToken.chainId)
    const fromTokenAddress = this.fromSelectedToken.address.toLowerCase()
    this.toTokenListStatus = 'LOADING'
    this.emitUpdate()

    try {
      const toTokenList = (await this.#api.getToTokenList(chainId)).filter(
        (token) => token.address.toLowerCase() !== fromTokenAddress
      )
      if (requestId !== this.#toTokenListId) return
      this.toTokenList = toTokenList
      if (this.toSelectedToken?.chainId !== chainId) this.toSelectedToken = null
      this.toTokenListStatus = 'SUCCESS'
    } catch (error: any) {
      if (requestId !== this.#toTokenListId) return
      this.toTokenListStatus = 'ERROR'
      this.emitError({
        level: 'major',
        message: 'The receive-token list is temporarily unavailable. Please try again.',
        error
      })
    }

    this.emitUpdate()
  }

  updateForm(update: UpdateForm) {
    if (this.placementStatus === 'PLACING') return
    this.#prepareOrderId = generateUuid()
    const previousFromTokenId = this.fromSelectedToken
      ? `${this.fromSelectedToken.chainId}:${this.fromSelectedToken.address.toLowerCase()}`
      : ''
    if ('fromSelectedToken' in update) this.fromSelectedToken = update.fromSelectedToken || null
    if ('toSelectedToken' in update) this.toSelectedToken = update.toSelectedToken || null
    if ('fromAmount' in update) {
      this.fromAmount = sanitizeDecimalInput(update.fromAmount || '')
      this.marketQuote = null
      if (!this.#isLimitPriceUserEdited) this.limitPrice = ''
    }
    if ('limitPrice' in update) {
      this.limitPrice = sanitizeDecimalInput(update.limitPrice || '')
      this.#isLimitPriceUserEdited = true
    }
    if ('expirationSeconds' in update && update.expirationSeconds) {
      this.expirationSeconds = update.expirationSeconds
    }

    const nextFromTokenId = this.fromSelectedToken
      ? `${this.fromSelectedToken.chainId}:${this.fromSelectedToken.address.toLowerCase()}`
      : ''
    const didFromTokenChange = previousFromTokenId !== nextFromTokenId
    const didToTokenChange = 'toSelectedToken' in update
    if (didFromTokenChange || didToTokenChange) {
      this.limitPrice = ''
      this.marketQuote = null
      this.#isLimitPriceUserEdited = false
    }
    if (didFromTokenChange) {
      if (
        this.toSelectedToken &&
        this.fromSelectedToken &&
        (BigInt(this.toSelectedToken.chainId) !== this.fromSelectedToken.chainId ||
          this.toSelectedToken.address.toLowerCase() ===
            this.fromSelectedToken.address.toLowerCase())
      ) {
        this.toSelectedToken = null
      }
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.#updateToTokenList()
    }

    this.preparedOrder = null
    this.prepareOrderStatus = 'INITIAL'
    this.placementStatus = 'INITIAL'
    this.placementError = ''
    this.destroySignAccountOp()
    this.#schedulePrepareOrder()
    this.emitUpdate()
  }

  setMaxAmount() {
    this.updateForm({ fromAmount: this.maxFromAmount })
  }

  #schedulePrepareOrder() {
    this.#clearPrepareOrderTimeout()
    if (!this.canQuoteMarket) return
    this.prepareOrderStatus = 'LOADING'

    this.#prepareOrderTimeout = setTimeout(() => {
      this.#prepareOrderTimeout = undefined
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.prepareOrder()
    }, 500)
  }

  get #fromSelectedTokenInPortfolio() {
    return this.portfolioTokenList.find(
      (token) =>
        token.address.toLowerCase() === this.fromSelectedToken?.address.toLowerCase() &&
        token.chainId === this.fromSelectedToken.chainId
    )
  }

  get maxFromAmount() {
    const token = this.#fromSelectedTokenInPortfolio
    if (!token) return '0'
    return formatUnits(getTokenAmount(token), token.decimals)
  }

  get validateFromAmount(): Validation {
    const token = this.#fromSelectedTokenInPortfolio
    if (!token) return { severity: 'error', message: '' }
    return validateSendTransferAmount(this.fromAmount, token)
  }

  get validateLimitPrice(): Validation {
    if (!this.limitPrice) return { severity: 'error', message: '' }
    try {
      if (!this.toSelectedToken || parseUnits(this.limitPrice, this.toSelectedToken.decimals) <= 0n)
        return { severity: 'error', message: 'Enter a limit price greater than zero.' }
    } catch {
      return {
        severity: 'error',
        message: `Enter a price with no more than ${this.toSelectedToken?.decimals || 0} decimals.`
      }
    }
    return { severity: 'success', message: '' }
  }

  get targetBuyAmount() {
    if (!this.fromSelectedToken || !this.toSelectedToken || !this.fromAmount || !this.limitPrice)
      return 0n

    try {
      const sellAmount = parseUnits(this.fromAmount, this.fromSelectedToken.decimals)
      const price = parseUnits(this.limitPrice, this.toSelectedToken.decimals)
      const sellTokenUnit = 10n ** BigInt(this.fromSelectedToken.decimals)
      return (sellAmount * price + sellTokenUnit - 1n) / sellTokenUnit
    } catch {
      return 0n
    }
  }

  get receiveAmount() {
    if (!this.toSelectedToken) return ''
    if (!this.preparedOrder && !this.#isLimitPriceUserEdited && this.marketQuote) {
      return formatUnits(this.marketQuote.currentMarketBuyAmount, this.toSelectedToken.decimals)
    }
    if (!this.targetBuyAmount) return ''
    return formatUnits(this.targetBuyAmount, this.toSelectedToken.decimals)
  }

  get currentMarketPrice() {
    if (!this.marketQuote || !this.fromSelectedToken || !this.toSelectedToken) return ''
    let marketBuyAmount: bigint
    let sellAmount: bigint
    try {
      marketBuyAmount = BigInt(this.marketQuote.currentMarketBuyAmount)
      sellAmount = parseUnits(this.fromAmount, this.fromSelectedToken.decimals)
    } catch {
      return ''
    }

    return formatPrice({
      buyAmount: marketBuyAmount,
      sellAmount,
      buyDecimals: this.toSelectedToken.decimals,
      sellDecimals: this.fromSelectedToken.decimals
    })
  }

  get marketPriceDifferencePercent() {
    if (!this.currentMarketPrice || !this.limitPrice) return null
    const current = Number(this.currentMarketPrice)
    const limit = Number(this.limitPrice)
    if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(limit)) return null
    return ((limit - current) / current) * 100
  }

  get canQuoteMarket() {
    return (
      !!this.#selectedAccount.account &&
      !!this.fromSelectedToken &&
      !!this.toSelectedToken &&
      !!this.fromAmount &&
      !this.validateFromAmount.message
    )
  }

  get canPrepareOrder() {
    return this.canQuoteMarket && !this.validateLimitPrice.message && this.targetBuyAmount > 0n
  }

  async prepareOrder() {
    if (!this.#featureFlags.isFeatureEnabled('limitOrders')) return
    if (!this.canQuoteMarket || !this.#selectedAccount.account) return
    const requestId = generateUuid()
    this.#prepareOrderId = requestId
    this.prepareOrderStatus = 'LOADING'
    this.emitUpdate()

    try {
      const fromToken = this.fromSelectedToken!
      const toToken = this.toSelectedToken!
      const quoteParams = {
        fromToken,
        toToken,
        fromAmount: parseUnits(this.fromAmount, fromToken.decimals),
        owner: this.#selectedAccount.account.addr,
        validTo: Math.floor(Date.now() / 1000) + this.expirationSeconds,
        feePercent: this.feePercent
      }

      if (!this.canPrepareOrder) {
        const marketQuote = await this.#api.getMarketQuote(quoteParams)
        if (requestId !== this.#prepareOrderId) return

        this.marketQuote = marketQuote
        this.prepareOrderStatus = 'SUCCESS'
        if (!this.#isLimitPriceUserEdited) {
          this.limitPrice = formatPrice({
            buyAmount: BigInt(marketQuote.currentMarketBuyAmount),
            sellAmount: quoteParams.fromAmount,
            buyDecimals: toToken.decimals,
            sellDecimals: fromToken.decimals
          })
          this.#schedulePrepareOrder()
        }
        this.emitUpdate()
        return
      }

      const preparedOrder = await this.#api.prepareOrder({
        ...quoteParams,
        targetBuyAmount: this.targetBuyAmount
      })
      if (requestId !== this.#prepareOrderId) return

      this.preparedOrder = preparedOrder
      this.marketQuote = preparedOrder
      this.prepareOrderStatus = 'SUCCESS'
      await this.#initSignAccountOp(requestId)
    } catch (error: any) {
      if (requestId !== this.#prepareOrderId) return
      this.prepareOrderStatus = 'ERROR'
      this.emitError({
        level: 'major',
        message: error?.message || 'The limit order could not be prepared. Please try again.',
        error
      })
    }

    this.emitUpdate()
  }

  async #initSignAccountOp(requestId: string) {
    if (!this.preparedOrder || !this.#selectedAccount.account) return
    const network = this.#networks.networks.find(
      ({ chainId }) => chainId === BigInt(this.preparedOrder!.chainId)
    )
    if (!network) return
    const provider = this.#providers.providers[network.chainId.toString()]
    if (!provider) return
    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      this.#selectedAccount.account.addr,
      network.chainId
    )
    if (!accountState || requestId !== this.#prepareOrderId) return

    const calls = await getApprovalAndActionCalls(
      this.preparedOrder.userTx,
      this.#selectedAccount.account,
      provider,
      accountState
    )
    if (requestId !== this.#prepareOrderId) return

    const baseAccount = getBaseAccount(
      this.#selectedAccount.account,
      accountState,
      network,
      this.#featureFlags.isFeatureEnabled('erc4337'),
      this.#featureFlags.isFeatureEnabled('eip7702')
    )
    const accountOp: AccountOp = {
      id: generateUuid(),
      accountAddr: this.#selectedAccount.account.addr,
      chainId: network.chainId,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      nonce: accountState.nonce,
      signature: null,
      calls,
      meta: {
        limitOrder: {
          chainId: this.preparedOrder.chainId,
          isEthFlow: this.preparedOrder.isEthFlow,
          order: this.preparedOrder.order,
          orderUid: this.preparedOrder.orderUid
        },
        paymasterService: getAmbirePaymasterService(baseAccount, this.#relayerUrl),
        fromQuoteId: requestId
      }
    }

    await this.#signAccountOpPreference.initialLoadPromise
    this.#signAccountOpController = new SignAccountOpController({
      type: 'one-click-limit-order',
      callRelayer: this.#callRelayer,
      accounts: this.#accounts,
      networks: this.#networks,
      keystore: this.#keystore,
      portfolio: this.#portfolio,
      featureFlags: this.#featureFlags,
      signAccountOpPreference: this.#signAccountOpPreference,
      externalSignerControllers: this.#externalSignerControllers,
      activity: this.#activity,
      account: this.#selectedAccount.account,
      network,
      provider,
      phishing: this.#phishing,
      dapps: this.#dapps,
      erc7730: this.#erc7730,
      fromRequestId: randomId(),
      accountOp,
      shouldSimulate: false,
      onBroadcastSuccess: async (props) => {
        this.#portfolio
          .simulateAccountOp(props.accountOp)
          .then(() => {
            this.#portfolio.markSimulationAsBroadcasted(accountOp.accountAddr, accountOp.chainId)
          })
          .catch((error) => {
            this.emitError({
              level: 'silent',
              message: 'Limit order simulation failed after broadcast.',
              error
            })
          })
        await this.#onBroadcastSuccess(props)
      },
      onBroadcastFailed: this.#onBroadcastFailed
    })
    this.#signAccountOpController.onUpdate(
      (forceEmit) => this.propagateUpdate(forceEmit),
      'limit-orders'
    )
    this.#signAccountOpController.onError((error) => this.emitError({ ...error, level: 'silent' }))
  }

  #startPlacement(limitOrder?: LimitOrderData) {
    if (!limitOrder) return
    this.#placementId = generateUuid()
    this.placementStatus = 'PLACING'
    this.placementError = ''
    this.#placementAttempts = 0
    this.#placementInterval.restart({ runImmediately: true })
    this.emitUpdate()
  }

  handleBroadcastSuccess(accountOp: AccountOp) {
    this.hasProceeded = false
    this.#startPlacement(accountOp.meta?.limitOrder)
  }

  async #tryPlaceOrder() {
    const placementId = this.#placementId
    const limitOrder =
      this.#signAccountOpController?.accountOp.meta?.limitOrder || this.preparedOrder
    if (!limitOrder || this.placementStatus !== 'PLACING') {
      this.#placementInterval.stop()
      return
    }

    this.#placementAttempts += 1
    try {
      const isPlaced = await this.#api.tryPlaceOrder(limitOrder)
      if (placementId !== this.#placementId || this.placementStatus !== 'PLACING') return
      if (isPlaced) {
        this.placementStatus = 'PLACED'
        this.#placementInterval.stop()
        this.emitUpdate()
        return
      }
    } catch (error: any) {
      if (placementId !== this.#placementId || this.placementStatus !== 'PLACING') return
      if (this.#placementAttempts < MAX_ORDER_PLACEMENT_ATTEMPTS) return
      this.placementStatus = 'FAILED'
      this.placementError = 'The transaction was sent, but the order could not be placed.'
      this.#placementInterval.stop()
      this.emitError({ level: 'major', message: this.placementError, error })
      this.emitUpdate()
      return
    }

    if (this.#placementAttempts >= MAX_ORDER_PLACEMENT_ATTEMPTS) {
      this.placementStatus = 'FAILED'
      this.placementError = 'The transaction was sent, but CoW Swap has not accepted the order yet.'
      this.#placementInterval.stop()
      this.emitUpdate()
    }
  }

  get signAccountOpController(): ISignAccountOpController | null {
    if (
      this.#signAccountOpController?.accountOp.meta?.fromQuoteId !== this.#prepareOrderId ||
      !this.preparedOrder
    )
      return null
    return this.#signAccountOpController
  }

  get formStatus(): LimitOrderFormStatus {
    if (this.placementStatus === 'PLACED') return 'PLACED'
    if (this.placementStatus === 'PLACING') return 'PLACING'
    if (this.placementStatus === 'FAILED') return 'FAILED'
    if (this.hasProceeded) return 'PROCEEDED'
    if (!this.fromSelectedToken || !this.toSelectedToken || !this.fromAmount || !this.limitPrice)
      return 'EMPTY'
    if (this.validateFromAmount.message || this.validateLimitPrice.message) return 'INVALID'
    if (this.prepareOrderStatus === 'LOADING' || !this.signAccountOpController) return 'PREPARING'
    if (this.signAccountOpController.estimation.status !== EstimationStatus.Success)
      return 'READY_TO_ESTIMATE'
    return 'READY_TO_SUBMIT'
  }

  get networkUserRequests() {
    if (!this.fromSelectedToken || !this.#selectedAccount.account) return []
    return this.#getUserRequests().filter(
      (request) =>
        request.kind === 'calls' &&
        request.meta.accountAddr === this.#selectedAccount.account?.addr &&
        request.meta.chainId === this.fromSelectedToken?.chainId &&
        !request.signAccountOp.accountOp.signature
    ) as CallsUserRequest[]
  }

  get requestParams() {
    const accountOp = this.signAccountOpController?.accountOp
    if (!accountOp) return null
    return {
      accountOp,
      calls: accountOp.calls,
      meta: {
        accountAddr: accountOp.accountAddr,
        chainId: accountOp.chainId,
        limitOrder: accountOp.meta?.limitOrder,
        paymasterService: accountOp.meta?.paymasterService
      }
    }
  }

  get signErrors(): SignAccountOpError[] {
    return []
  }

  setUserProceeded(hasProceeded: boolean) {
    this.hasProceeded = hasProceeded
    this.emitUpdate()
  }

  async callSignAccountOpMethod(method: string, args: any[]) {
    const controller = this.signAccountOpController as any
    if (!controller || typeof controller[method] !== 'function') return
    await controller[method](...args)
  }

  cancelSignReq() {
    this.#signAccountOpController?.cancelSignReq()
  }

  destroySignAccountOp() {
    if (!this.#signAccountOpController) return
    this.#signAccountOpController.destroy()
    this.#signAccountOpController = null
    this.hasProceeded = false
  }

  resetForm() {
    this.#clearPrepareOrderTimeout()
    this.#prepareOrderId = generateUuid()
    this.#placementId = generateUuid()
    this.#placementInterval.stop()
    this.destroySignAccountOp()
    this.fromAmount = ''
    this.limitPrice = ''
    this.#isLimitPriceUserEdited = false
    this.toSelectedToken = null
    this.preparedOrder = null
    this.marketQuote = null
    this.prepareOrderStatus = 'INITIAL'
    this.placementStatus = 'INITIAL'
    this.placementError = ''
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      currentMarketPrice: this.currentMarketPrice,
      formStatus: this.formStatus,
      marketPriceDifferencePercent: this.marketPriceDifferencePercent,
      maxFromAmount: this.maxFromAmount,
      networkUserRequests: this.networkUserRequests,
      receiveAmount: this.receiveAmount,
      requestParams: this.requestParams,
      signAccountOpController: this.signAccountOpController,
      signErrors: this.signErrors,
      targetBuyAmount: this.targetBuyAmount,
      validateFromAmount: this.validateFromAmount,
      validateLimitPrice: this.validateLimitPrice
    }
  }
}
