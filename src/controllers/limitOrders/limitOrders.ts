import { formatUnits, Interface, isAddress, parseUnits, ZeroAddress } from 'ethers'

import EmittableError from '../../classes/EmittableError'
import { RecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout'
import SwapAndBridgeError from '../../classes/SwapAndBridgeError'
import { STK_WALLET } from '../../consts/addresses'
import { DEFAULT_LIMIT_ORDER_PRICE } from '../../consts/limitOrders'
import { TO_TOKEN_LIST_CACHE_THRESHOLD, TO_TOKEN_LIST_LIMIT } from '../../consts/swapAndBridge'
import { Account, IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { IContractInfoController } from '../../interfaces/contractInfo'
import { IDappsController } from '../../interfaces/dapp'
import { IErc7730Controller } from '../../interfaces/erc7730'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore'
import {
  LimitOrder,
  LimitOrderExpiry,
  LimitOrderFormStatus,
  LimitOrderMarketQuote,
  LimitOrderPrice,
  LimitOrderPriceError,
  LimitOrderPriceView,
  LimitOrderSignPurpose,
  LimitOrderStatus,
  LimitOrderToken
} from '../../interfaces/limitOrders'
import { INetworksController, Network } from '../../interfaces/network'
import { IPhishingController } from '../../interfaces/phishing'
import { Platform } from '../../interfaces/platform'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController, RPCProvider } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { SignAccountOpError } from '../../interfaces/signAccountOp'
import { IStorageController } from '../../interfaces/storage'
import {
  CowSwapOrderCreation,
  CowSwapOrderStruct,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeToToken
} from '../../interfaces/swapAndBridge'
import { IUiController, View } from '../../interfaces/ui'
import { CallsUserRequest } from '../../interfaces/userRequest'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { Call } from '../../libs/accountOp/types'
import { getAmbirePaymasterService } from '../../libs/erc7677/erc7677'
import { randomId } from '../../libs/humanizer/utils'
import { getAccountNetworks } from '../../libs/networks/networks'
import { TokenResult } from '../../libs/portfolio'
import { getTokenMetaViaRPC } from '../../libs/portfolio/getTokenMetaViaRPC'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import { PORTFOLIO_LIB_ERROR_NAMES } from '../../libs/portfolio/portfolio'
import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall'
import {
  FeeExemptionReason,
  getFeeExemptionReason,
  getFeePercent,
  getFeePercentForStkWalletToken
} from '../../libs/swapAndBridge/fee'
import {
  addCustomTokensIfNeeded,
  convertPortfolioTokenToSwapAndBridgeToToken,
  getBannedToTokenList,
  getIsTokenEligibleForSwapAndBridge,
  getSwapAndBridgeCalls,
  isNoFeeToken,
  sortPortfolioTokenList,
  sortTokenListResponse
} from '../../libs/swapAndBridge/swapAndBridge'
import { getHumanReadableSwapAndBridgeError } from '../../libs/swapAndBridge/swapAndBridgeErrorHumanizer'
import { getSanitizedAmount } from '../../libs/transfer/amount'
import { CowSwapAPI } from '../../services/cowswap/api'
import {
  COWSWAP_BUY_NATIVE_TOKEN_ADDRESS,
  COWSWAP_ETH_FLOW_ADDRESS,
  COWSWAP_LIMIT_ORDER_EXPIRY_SECONDS,
  COWSWAP_NETWORK_COST_INCREASE_PERCENT,
  COWSWAP_SETTLEMENT_ADDRESS,
  COWSWAP_SUPPORTED_CHAINS,
  COWSWAP_VAULT_RELAYER_ADDRESS
} from '../../services/cowswap/constants'
import {
  buildLimitOrderAppData,
  computeOrderUid,
  ethFlowInterface,
  getCowSwapOrderStruct,
  getEthFlowOrderData,
  getPartnerFeeBpsFromAppData,
  getWrappedNativeTokenAddress,
  normalizeBuyTokenAddress,
  settlementInterface,
  sortCowSwapTokensByPopularity
} from '../../services/cowswap/helper'
import { CowSwapAccountOrder } from '../../services/cowswap/types'
import { generateUuid } from '../../utils/uuid'
import EventEmitter from '../eventEmitter/eventEmitter'
import {
  OnBroadcastFailed,
  OnBroadcastSuccess,
  SignAccountOpController
} from '../signAccountOp/signAccountOp'
import { SignAccountOpPreferenceController } from '../signAccountOp/signAccountOpPreference'

type SignAccountOpControllerMethods = {
  [K in keyof SignAccountOpController as SignAccountOpController[K] extends (...args: any) => any
    ? K
    : never]: SignAccountOpController[K]
}

export const STATUS_WRAPPED_METHODS = {
  addToTokenByAddress: 'INITIAL',
  placeOrder: 'INITIAL',
  cancelOrder: 'INITIAL'
} as const

/** How often today's price is refreshed while the form is open */
const MARKET_QUOTE_UPDATE_INTERVAL = 30 * 1000

/**
 * How old today's price can be and still be used. Longer than the refresh interval, so a slow
 * refresh doesn't empty the form meanwhile
 */
const MARKET_QUOTE_MAX_AGE = 3 * MARKET_QUOTE_UPDATE_INTERVAL

/** How old the orders can be when the dashboard opens before they're fetched again */
const DASHBOARD_ORDERS_MAX_AGE = 60 * 1000

/** How often My orders is refreshed while it's open */
const ORDERS_UPDATE_INTERVAL = 30 * 1000

/** How long to wait for the user to stop typing before asking for today's price */
const MARKET_QUOTE_DEBOUNCE_MS = 400

/**
 * The routes of the trade screens: Swap & Bridge, the limit order form and My orders. The form
 * is kept while the user moves between them, and cleared once no view shows any of them
 */
const TRADE_ROUTES = ['swap-and-bridge', 'limit-order', 'limit-orders']

const isTradeRoute = (route: string | undefined) => !!route && TRADE_ROUTES.includes(route)

/** Wraps the native token into its wrapped version, e.g. ETH into WETH */
const wrappedNativeTokenInterface = new Interface(['function deposit() payable'])

/** See #getAbsoluteTargetBuyAmount */
const PRICE_EXTRA_DECIMALS = 18

/** The highest relative `bps` that keeps the "cost" price above zero */
const MAX_COST_VIEW_BPS = 9900

/** A number as a decimal string without exponent notation, e.g. 0.0000000033 not 3.3e-9 */
const toPlainDecimalString = (value: number) =>
  value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 12 })

type ToTokenList = {
  apiTokens: SwapAndBridgeToToken[]
  /** Tokens the user added by pasting their address */
  addedTokens: SwapAndBridgeToToken[]
  fetchedAt: number
}

/**
 * Maps the status CoW Swap reports to the one shown in My orders. Null hides the order: an
 * order waiting for its pre-sign transaction that this session didn't broadcast was abandoned
 * before signing, and never becomes active
 */
const getOrderStatus = ({
  order,
  isPlacing,
  isCancelling
}: {
  order: CowSwapAccountOrder
  isPlacing: boolean
  isCancelling: boolean
}): LimitOrderStatus | null => {
  const hasFilledPart = BigInt(order.executedSellAmount) > 0n

  // CoW Swap refused an ETH-flow order after its transaction created it. The native token stays
  // in the ETH-flow contract until the order is cancelled
  const isStillWaiting = ['presignaturePending', 'open', 'expired'].includes(order.status)
  if (order.onchainOrderData?.placementError && isStillWaiting) {
    return isCancelling ? 'cancelling' : 'rejected'
  }
  if (order.status === 'presignaturePending') return isPlacing ? 'placing' : null
  if (order.status === 'open' && isCancelling) return 'cancelling'
  if (order.status === 'open') return hasFilledPart ? 'partiallyFilled' : 'open'

  const finalStatuses: Record<string, LimitOrderStatus> = {
    fulfilled: 'filled',
    cancelled: 'cancelled',
    expired: 'expired'
  }

  return finalStatuses[order.status] ?? null
}

/**
 * Builds, places and cancels CoW Swap limit orders, and lists the ones the selected account
 * placed from Ambire. An order is sent to CoW Swap first and becomes active with a transaction:
 * a pre-sign, or creating it with the native token through the ETH-flow contract. Cancelling is
 * a transaction too, so it works for smart accounts, which can't sign orders as messages
 */
export class LimitOrdersController extends EventEmitter {
  #callRelayer: BindedRelayerCall

  #accounts: IAccountsController

  #keystore: IKeystoreController

  #portfolio: IPortfolioController

  #externalSignerControllers: ExternalSignerControllers

  #providers: IProvidersController

  #selectedAccount: ISelectedAccountController

  #networks: INetworksController

  #activity: IActivityController

  #signAccountOpPreference: SignAccountOpPreferenceController

  #featureFlags: IFeatureFlagsController

  #platform: Platform

  #phishing: IPhishingController

  #dapps: IDappsController

  #erc7730: IErc7730Controller

  #contractInfo: IContractInfoController

  #relayerUrl: string

  #cowSwapApi: CowSwapAPI

  #onBroadcastSuccess: OnBroadcastSuccess

  #onBroadcastFailed: OnBroadcastFailed

  #requestSignatureInWindow: (userRequestParams: {
    calls: Call[]
    meta: CallsUserRequest['meta']
  }) => Promise<void>

  /** The views (windows, the side panel, the mobile app) that show a trade screen right now */
  #viewIdsOnTradeRoutes = new Set<string>()

  #signAccountOpController: SignAccountOpController | null = null

  /** The "to" token lists, per network */
  #toTokenLists = new Map<number, ToTokenList>()

  /** The "to" token list of the selected network, merged with the account's tokens and sorted */
  #toTokens: SwapAndBridgeToToken[] = []

  /** The portfolio `#toTokens` was sorted by, see `#getToTokensPortfolioSignature` */
  #toTokensPortfolioSignature = ''

  #marketQuoteRequestId = 0

  #marketQuoteDebounce: ReturnType<typeof setTimeout> | null = null

  #updateMarketQuoteInterval: RecurringTimeout

  #updateOrdersInterval: RecurringTimeout

  /** The orders of `ordersAccountAddr` as CoW Swap returned them, per network */
  #accountOrders = new Map<number, CowSwapAccountOrder[]>()

  /** Orders whose pre-sign or ETH-flow transaction was broadcast this session */
  #placingOrderUids = new Set<string>()

  #portfolioUpdate: (chainIds: bigint[]) => void

  #storage: IStorageController

  #initialLoadPromise: Promise<void> | undefined

  /** See `limitOrdersAccounts` in the storage */
  #accountsWithOrders = new Set<string>()

  /** The last write of `#accountsWithOrders`, as writes to the storage must not run in parallel */
  #accountsWithOrdersWrite: Promise<unknown> = Promise.resolve()

  /**
   * How much each order of the account had received at the last refresh, to notice when one
   * fills (or fills a part) and refresh the balances it changed
   */
  #executedBuyAmounts = new Map<string, bigint>()

  /** The My orders refresh in progress, which simultaneous refreshes share */
  #ordersUpdate: Promise<void> | null = null

  /** Whether only the token permission of the order being signed was sent */
  #hasPartiallyBroadcast = false

  /** Orders whose cancel transaction was broadcast this session */
  #cancellingOrderUids = new Set<string>()

  /**
   * The calls that place or cancel an order, handed to the signing window (Safe accounts), by
   * `#getSentCallKey`. The user can still reject them there, so the order is shown as placing or
   * cancelling only once its call is broadcast (see `onAccountOpBroadcast`)
   */
  #callsSentToWindow = new Map<string, { orderUid: string; purpose: LimitOrderSignPurpose }>()

  #tokenInfoCache = new Map<string, LimitOrderToken>()

  #lastSelectedAccountAddr: string | null = null

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  /** The screens that show the form. The form resets when the last one closes */
  sessionIds: string[] = []

  /** The screens that show My orders. My orders refreshes while one is open */
  ordersSessionIds: string[] = []

  /** The tokens the account can sell with a limit order, in the order Swap & Bridge lists them */
  fromTokenList: TokenResult[] = []

  fromSelectedToken: TokenResult | null = null

  /** In human units of `fromSelectedToken` */
  fromAmount: string = ''

  toSelectedToken: SwapAndBridgeToToken | null = null

  /** Null until today's price is known, then the side whose price reads as 1 or more */
  priceView: LimitOrderPriceView | null = null

  price: LimitOrderPrice = DEFAULT_LIMIT_ORDER_PRICE

  expiry: LimitOrderExpiry = '7d'

  marketQuote: LimitOrderMarketQuote | null = null

  marketQuoteStatus: 'INITIAL' | 'LOADING' | 'ERROR' = 'INITIAL'

  marketQuoteError: string | null = null

  /** The Ambire fee, in percent, by the amount of stkWALLET the account holds */
  feePercent: number = getFeePercent()

  /** Whether the user asked to place the order and the signing modal is open */
  hasProceeded: boolean = false

  signAccountOpPurpose: LimitOrderSignPurpose | null = null

  /**
   * How many transactions were sent to the signing window instead of being signed here. The
   * popup closes when it grows, as the signing window takes over
   */
  signRequestsInWindowCount: number = 0

  /** The order the user just placed, for the confirmation screen. Cleared on the next edit */
  lastPlacedOrderUid: string | null = null

  toTokenSearchTerm: string = ''

  toTokenSearchResults: SwapAndBridgeToToken[] = []

  isTokenListLoading: boolean = false

  toTokenListError: string | null = null

  orders: LimitOrder[] = []

  /** The account `orders` belong to */
  ordersAccountAddr: string | null = null

  ordersError: string | null = null

  isUpdatingOrders: boolean = false

  ordersUpdatedAt: number | null = null

  constructor({
    eventEmitterRegistry,
    callRelayer,
    accounts,
    keystore,
    portfolio,
    externalSignerControllers,
    providers,
    selectedAccount,
    networks,
    activity,
    signAccountOpPreference,
    featureFlags,
    platform,
    phishing,
    dapps,
    erc7730,
    contractInfo,
    relayerUrl,
    cowSwapApi,
    onBroadcastSuccess,
    onBroadcastFailed,
    ui,
    requestSignatureInWindow,
    portfolioUpdate,
    storage
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    callRelayer: BindedRelayerCall
    accounts: IAccountsController
    keystore: IKeystoreController
    portfolio: IPortfolioController
    externalSignerControllers: ExternalSignerControllers
    providers: IProvidersController
    selectedAccount: ISelectedAccountController
    networks: INetworksController
    activity: IActivityController
    signAccountOpPreference: SignAccountOpPreferenceController
    featureFlags: IFeatureFlagsController
    platform: Platform
    phishing: IPhishingController
    dapps: IDappsController
    erc7730: IErc7730Controller
    contractInfo: IContractInfoController
    relayerUrl: string
    cowSwapApi: CowSwapAPI
    onBroadcastSuccess: OnBroadcastSuccess
    onBroadcastFailed: OnBroadcastFailed
    ui: IUiController
    /**
     * Adds the calls to the account's batch and opens the window that signs it. Safe accounts
     * sign there, as their transactions may need more than one owner
     */
    requestSignatureInWindow: (userRequestParams: {
      calls: Call[]
      meta: CallsUserRequest['meta']
    }) => Promise<void>
    /** Refreshes the selected account's portfolio on these networks */
    portfolioUpdate: (chainIds: bigint[]) => void
    storage: IStorageController
  }) {
    super(eventEmitterRegistry)

    this.#callRelayer = callRelayer
    this.#accounts = accounts
    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#externalSignerControllers = externalSignerControllers
    this.#providers = providers
    this.#selectedAccount = selectedAccount
    this.#networks = networks
    this.#activity = activity
    this.#signAccountOpPreference = signAccountOpPreference
    this.#featureFlags = featureFlags
    this.#platform = platform
    this.#phishing = phishing
    this.#dapps = dapps
    this.#erc7730 = erc7730
    this.#contractInfo = contractInfo
    this.#relayerUrl = relayerUrl
    this.#cowSwapApi = cowSwapApi
    this.#onBroadcastSuccess = onBroadcastSuccess
    this.#onBroadcastFailed = onBroadcastFailed
    this.#requestSignatureInWindow = requestSignatureInWindow
    this.#portfolioUpdate = portfolioUpdate
    this.#storage = storage
    this.#initialLoadPromise = this.#load().finally(() => {
      this.#initialLoadPromise = undefined
    })

    this.#updateMarketQuoteInterval = new RecurringTimeout(
      async () => this.#continuouslyUpdateMarketQuote(),
      MARKET_QUOTE_UPDATE_INTERVAL,
      this.emitError.bind(this)
    )
    this.#updateOrdersInterval = new RecurringTimeout(
      async () => this.#continuouslyUpdateOrders(),
      ORDERS_UPDATE_INTERVAL,
      this.emitError.bind(this)
    )

    this.#selectedAccount.onUpdate(() => this.#onSelectedAccountUpdate(), 'limit-orders')

    ui.uiEvent.on('updateView', (view: View) => {
      if (isTradeRoute(view.currentRoute)) {
        this.#viewIdsOnTradeRoutes.add(view.id)
        return
      }
      this.#onViewLeftTradeRoutes(view.id)
    })
    ui.uiEvent.on('removeView', (view: View) => this.#onViewLeftTradeRoutes(view.id))
  }

  async #load() {
    try {
      const accounts = await this.#storage.get('limitOrdersAccounts', [])
      accounts.forEach((addr) => this.#accountsWithOrders.add(addr.toLowerCase()))
    } catch (error: any) {
      this.emitError({ level: 'silent', message: 'Failed to load the limit order accounts', error })
    }
  }

  /** Remembers that the account has limit orders, so the dashboard shows them */
  #rememberAccountWithOrders(accountAddr: string) {
    const addr = accountAddr.toLowerCase()
    if (this.#accountsWithOrders.has(addr)) return

    this.#accountsWithOrders.add(addr)
    const accounts = [...this.#accountsWithOrders]
    this.#accountsWithOrdersWrite = this.#accountsWithOrdersWrite
      .then(() => this.#storage.set('limitOrdersAccounts', accounts))
      .catch((error) => {
        this.emitError({
          level: 'silent',
          message: 'Failed to save the limit order accounts',
          error
        })
      })
  }

  /**
   * Fetches the selected account's orders for the dashboard, if it placed limit orders from this
   * device and they weren't fetched in the last minute. Other accounts aren't sent to CoW Swap
   */
  async refreshOrdersIfNeeded() {
    await this.#initialLoadPromise

    const accountAddr = this.#selectedAccount.account?.addr
    if (!accountAddr || !this.#accountsWithOrders.has(accountAddr.toLowerCase())) return

    const isFresh =
      this.ordersAccountAddr === accountAddr &&
      this.ordersUpdatedAt !== null &&
      Date.now() - this.ordersUpdatedAt < DASHBOARD_ORDERS_MAX_AGE
    if (isFresh) return

    await this.updateOrders()
  }

  #onSelectedAccountUpdate() {
    const accountAddr = this.#selectedAccount.account?.addr ?? null

    if (accountAddr !== this.#lastSelectedAccountAddr) {
      this.#lastSelectedAccountAddr = accountAddr
      // The form, the orders and anything being signed belong to the previous account
      this.resetForm()
      this.#clearOrders()
      this.emitUpdate()
      return
    }

    // The balances and the stkWALLET amount (the fee) come from the portfolio
    if (!this.sessionIds.length) return
    this.#updateFeePercent()
    this.#updateFromTokenList()
    if (!this.fromSelectedToken) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.#selectDefaultFromToken()
      return
    }
    // Sorting the "to" token list is costly, so it's redone only when the tokens it sorts by
    // changed
    const portfolioSignature = this.#getToTokensPortfolioSignature()
    if (portfolioSignature !== this.#toTokensPortfolioSignature) this.#deriveToTokens()
    this.emitUpdate()
  }

  /** Which of the account's tokens are on the selected network, and their balances and prices */
  #getToTokensPortfolioSignature(): string {
    const chainId = this.fromChainId
    if (!chainId) return ''

    const chainIdBigInt = BigInt(chainId)

    return this.#selectedAccount.portfolio.tokens
      .filter((t) => t.chainId === chainIdBigInt)
      .map((t) => {
        const priceUSD = t.priceIn.find(({ baseCurrency }) => baseCurrency === 'usd')?.price

        return `${t.address}:${t.amount}:${t.amountPostSimulation ?? ''}:${priceUSD ?? ''}`
      })
      .join()
  }

  /**
   * The same tokens Swap & Bridge offers to sell, by the same rules, on the networks where CoW
   * Swap takes limit orders: with a balance, a price (unless prices are off or failed to load
   * for the network) and not hidden
   */
  #updateFromTokenList() {
    const chainIdsWithPriceError = new Set<string>()
    const priceError = this.#selectedAccount.balanceAffectingErrors.find(
      (error) => error.id === PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError
    )
    priceError?.networkNames.forEach((networkName) => {
      const network = this.#networks.networks.find((n) => n.name === networkName)
      if (network) chainIdsWithPriceError.add(network.chainId.toString())
    })
    const areTokenPricesEnabled = this.#featureFlags.isFeatureEnabled('tokenPrices')

    const tokens = this.#selectedAccount.portfolio.tokens.filter(
      (token) =>
        this.supportedChainIds.includes(Number(token.chainId)) &&
        getIsTokenEligibleForSwapAndBridge(
          token,
          true,
          areTokenPricesEnabled && !chainIdsWithPriceError.has(token.chainId.toString())
        ) &&
        !token.flags.isHidden
    )

    this.fromTokenList = sortPortfolioTokenList(tokens)
  }

  /**
   * Picks the token to sell when the form has none, like Swap & Bridge does: the first one in
   * the list that isn't the receive token, on a network the account can use
   */
  async #selectDefaultFromToken() {
    if (this.fromSelectedToken) return

    const accountNetworkChainIds = getAccountNetworks(
      this.#networks.networks,
      this.#accounts.accountStates,
      this.#selectedAccount.account
    ).map((n) => n.chainId)
    const defaultFromToken = this.fromTokenList.find(
      (t) =>
        t.address !== this.toSelectedToken?.address && accountNetworkChainIds.includes(t.chainId)
    )
    if (!defaultFromToken) return

    await this.updateForm({ fromSelectedToken: defaultFromToken })
  }

  get fromChainId(): number | null {
    return this.fromSelectedToken ? Number(this.fromSelectedToken.chainId) : null
  }

  /** The networks where CoW Swap takes limit orders */
  get supportedChainIds(): number[] {
    return COWSWAP_SUPPORTED_CHAINS.map(({ chainId }) => chainId)
  }

  /** `fromSelectedToken` as the portfolio has it now, so its balance is up to date */
  #getFromTokenInPortfolio(): TokenResult | null {
    const fromToken = this.fromSelectedToken
    if (!fromToken) return null

    return (
      this.#selectedAccount.portfolio.tokens.find(
        (token) =>
          token.chainId === fromToken.chainId &&
          token.address.toLowerCase() === fromToken.address.toLowerCase() &&
          !token.flags.onGasTank &&
          !token.flags.rewardsType
      ) ?? null
    )
  }

  /** The balance of `fromSelectedToken`, in its smallest unit */
  get #fromBalance(): bigint {
    const token = this.#getFromTokenInPortfolio()

    return token ? getTokenAmount(token) : 0n
  }

  /** The whole balance of `fromSelectedToken`, in human units */
  get maxFromAmount(): string {
    const token = this.#getFromTokenInPortfolio()
    if (!token) return '0'

    return formatUnits(this.#fromBalance, token.decimals)
  }

  /** `fromAmount` in the smallest unit of `fromSelectedToken`. Null if empty or invalid */
  get #sellAmount(): bigint | null {
    if (!this.fromSelectedToken || !this.fromAmount) return null

    try {
      const amount = parseUnits(
        getSanitizedAmount(this.fromAmount, this.fromSelectedToken.decimals),
        this.fromSelectedToken.decimals
      )
      return amount > 0n ? amount : null
    } catch {
      return null
    }
  }

  /** Why the amount to sell can't be used, in plain words. Null if it can */
  get fromAmountError(): string | null {
    if (!this.fromSelectedToken || !this.fromAmount) return null

    const sellAmount = this.#sellAmount
    if (sellAmount === null) return 'Enter a valid amount.'
    if (sellAmount > this.#fromBalance) {
      return `You don't have enough ${this.fromSelectedToken.symbol}.`
    }

    return null
  }

  get #isSameToken(): boolean {
    const from = this.fromSelectedToken
    const to = this.toSelectedToken
    if (!from || !to) return false

    const fromAddr = from.address.toLowerCase()
    const toAddr = to.address.toLowerCase()
    if (fromAddr === toAddr) return true

    // Selling the native token for its wrapped version, or the other way around, is wrapping,
    // not a trade, so CoW Swap can't fill it
    const wrappedAddr = getWrappedNativeTokenAddress(Number(from.chainId))?.toLowerCase()
    const isWrap = fromAddr === ZeroAddress.toLowerCase() && toAddr === wrappedAddr
    const isUnwrap = fromAddr === wrappedAddr && toAddr === ZeroAddress.toLowerCase()

    return isWrap || isUnwrap
  }

  get feeExemptionReason(): FeeExemptionReason | undefined {
    const fromToken = this.fromSelectedToken

    return getFeeExemptionReason({
      isWrapOrUnwrap: false,
      isFeeExemptToken: !!fromToken && isNoFeeToken(Number(fromToken.chainId), fromToken.address)
    })
  }

  /** The Ambire fee the order carries, in basis points. Undefined if there is none */
  get #feeBps(): number | undefined {
    if (this.feeExemptionReason || this.feePercent <= 0) return undefined

    return Math.round(this.feePercent * 100)
  }

  #updateFeePercent() {
    const accountAddr = this.#selectedAccount.account?.addr
    if (!accountAddr) {
      this.feePercent = getFeePercent()
      return
    }

    const mainnetTokens = this.#portfolio.getAccountPortfolioState(accountAddr)['1']?.result?.tokens
    const stkWalletToken = mainnetTokens?.find(
      ({ address, chainId }) => chainId === 1n && address.toLowerCase() === STK_WALLET.toLowerCase()
    )

    this.feePercent = getFeePercentForStkWalletToken(stkWalletToken)
  }

  /** `marketQuote`, if it's for the current tokens and amount */
  get #currentMarketQuote(): LimitOrderMarketQuote | null {
    const quote = this.marketQuote
    const sellAmount = this.#sellAmount
    if (!quote || !this.fromSelectedToken || !this.toSelectedToken || !sellAmount) return null

    const isCurrent =
      quote.chainId === this.fromChainId &&
      quote.sellTokenAddress.toLowerCase() === this.fromSelectedToken.address.toLowerCase() &&
      quote.buyTokenAddress.toLowerCase() === this.toSelectedToken.address.toLowerCase() &&
      quote.sellAmount === sellAmount.toString()
    // An old price could let an order through that's worse than today's
    const isFresh = Date.now() - quote.fetchedAt < MARKET_QUOTE_MAX_AGE

    return isCurrent && isFresh ? quote : null
  }

  /** The receive amount for `price` read as an absolute price. Null if it can't be read */
  #getAbsoluteTargetBuyAmount(amount: string, view: LimitOrderPriceView): bigint | null {
    const sellAmount = this.#sellAmount
    const fromToken = this.fromSelectedToken
    const toToken = this.toSelectedToken
    if (!sellAmount || !fromToken || !toToken) return null

    // Typed prices are read with this many decimals more than the token has, so a price smaller
    // than the token's smallest unit (1 PEPE costs 0.0000089 USDC) isn't cut off
    const extraDecimals = PRICE_EXTRA_DECIMALS
    try {
      if (view === 'cost') {
        // How much of the sell token 1 whole receive token costs
        const decimals = fromToken.decimals + extraDecimals
        const sellPerBuyToken = parseUnits(getSanitizedAmount(amount, decimals), decimals)
        if (sellPerBuyToken <= 0n) return null

        return (sellAmount * 10n ** BigInt(toToken.decimals + extraDecimals)) / sellPerBuyToken
      }

      // How much of the receive token 1 whole sell token gets
      const decimals = toToken.decimals + extraDecimals
      const buyPerSellToken = parseUnits(getSanitizedAmount(amount, decimals), decimals)
      if (buyPerSellToken <= 0n) return null

      return (sellAmount * buyPerSellToken) / 10n ** BigInt(fromToken.decimals + extraDecimals)
    } catch {
      return null
    }
  }

  /**
   * What the whole amount is worth at the price the user set, before any fee, in the smallest
   * unit of the receive token. The price the user sets is the market price the order should fill
   * at, so it's compared to today's market price before fees. Null until it can be calculated
   */
  get #triggerBuyAmount(): bigint | null {
    const view = this.priceView ?? 'cost'

    if (this.price.mode === 'absolute') {
      return this.#getAbsoluteTargetBuyAmount(this.price.amount, view)
    }

    const quote = this.#currentMarketQuote
    if (!quote) return null

    const marketBuyAmount = BigInt(quote.buyAmountBeforeFees)
    if (view === 'cost') {
      // A price lower by `bps` gets proportionally more
      const bps = BigInt(Math.min(Math.max(Math.round(this.price.bps), 0), MAX_COST_VIEW_BPS))
      return (marketBuyAmount * 10000n) / (10000n - bps)
    }

    const bps = BigInt(Math.max(Math.round(this.price.bps), 0))
    return (marketBuyAmount * (10000n + bps)) / 10000n
  }

  get triggerBuyAmount(): string | null {
    return this.#triggerBuyAmount?.toString() ?? null
  }

  /**
   * The least the order receives, in the smallest unit of the receive token: what the price the
   * user set gets after CoW Swap's network cost and protocol fee and the Ambire fee. This is the
   * amount the order asks for, so it fills once the market reaches the user's price. The network
   * cost is today's estimate with room to grow, so the order fills at the user's price or just
   * before it, not after it, if the network gets busier. Null until it can be calculated, or if
   * the costs take it all
   */
  get #targetBuyAmount(): bigint | null {
    const triggerBuyAmount = this.#triggerBuyAmount
    const quote = this.#currentMarketQuote
    if (triggerBuyAmount === null || !quote) return null

    const sellAmount = BigInt(quote.sellAmount)
    // The same room for the network cost to grow as swaps and CoW Swap's own SDK leave
    const networkFee =
      (BigInt(quote.networkFee) * (100n + COWSWAP_NETWORK_COST_INCREASE_PERCENT)) / 100n
    // The Ambire fee as it is now, as the order carries the current one. Hundredths of a bps
    // keep CoW Swap's fractional protocol fee
    const feeHundredthsOfBps = BigInt(
      Math.round(((this.#feeBps ?? 0) + quote.protocolFeeBps) * 100)
    )
    // The network cost is paid in the sell token, so it takes the same share of what any price
    // gets. Both fees are a share of the amount before fees
    const keptPerMillion =
      ((sellAmount - networkFee) * 1_000_000n) / sellAmount - feeHundredthsOfBps
    if (networkFee >= sellAmount || keptPerMillion <= 0n) return null

    return (triggerBuyAmount * keptPerMillion) / 1_000_000n
  }

  get targetBuyAmount(): string | null {
    return this.#targetBuyAmount?.toString() ?? null
  }

  /** Why the price can't be used. Null if it can, or if it's not known yet */
  get priceError(): LimitOrderPriceError | null {
    if (!this.#sellAmount || !this.toSelectedToken) return null

    const triggerBuyAmount = this.#triggerBuyAmount
    if (this.price.mode === 'absolute' && triggerBuyAmount === null) return 'invalid'

    const quote = this.#currentMarketQuote
    if (!quote || triggerBuyAmount === null) return null

    // An order can't ask for a worse price than today's. It would fill right away at today's
    // price at best, so the user is better off with a swap
    if (triggerBuyAmount < BigInt(quote.buyAmountBeforeFees)) return 'worse-than-today'
    // The network cost and the fees would take everything the order gets
    if (this.#targetBuyAmount === null) return 'too-small'

    return null
  }

  get formStatus(): LimitOrderFormStatus {
    if (this.hasProceeded && this.signAccountOpPurpose === 'place') return 'PROCEEDED'
    if (this.statuses.placeOrder !== 'INITIAL') return 'PLACING'

    return this.#getFormFieldsStatus()
  }

  /** The status of the form by its fields alone, whether or not the order is being placed */
  #getFormFieldsStatus(): LimitOrderFormStatus {
    if (!this.fromSelectedToken || !this.toSelectedToken || !this.fromAmount) return 'EMPTY'
    if (this.fromAmountError || this.#isSameToken || !this.#sellAmount) return 'INVALID'

    if (!this.#currentMarketQuote) {
      return this.marketQuoteStatus === 'ERROR' ? 'PRICE_UNAVAILABLE' : 'LOADING_PRICE'
    }
    if (this.priceError) return 'INVALID'

    return 'READY'
  }

  /** Reasons the order can't be placed, shown on the form */
  get signErrors(): SignAccountOpError[] {
    if (this.#isSameToken) {
      return [{ title: 'Pick a different token to receive.' }]
    }

    return []
  }

  get signAccountOpController() {
    return this.#signAccountOpController
  }

  /** Whether a transaction is being signed or broadcast right now */
  get isSignAndBroadcastInProgress() {
    return !!this.#signAccountOpController?.isSignAndBroadcastInProgress
  }

  async initForm(
    sessionId: string,
    params?: { preselectedFromToken?: Pick<TokenResult, 'address' | 'chainId'> }
  ) {
    const isSessionAlreadyOpen = this.sessionIds.includes(sessionId)
    if (!isSessionAlreadyOpen) this.sessionIds.push(sessionId)
    this.#lastSelectedAccountAddr = this.#selectedAccount.account?.addr ?? null
    this.#updateFeePercent()
    this.#updateFromTokenList()

    const preselected = params?.preselectedFromToken
    if (preselected) {
      const token = this.#selectedAccount.portfolio.tokens.find(
        (t) =>
          t.chainId === BigInt(preselected.chainId) &&
          t.address.toLowerCase() === preselected.address.toLowerCase() &&
          !t.flags.onGasTank &&
          !t.flags.rewardsType
      )
      if (token && this.supportedChainIds.includes(Number(token.chainId))) {
        await this.updateForm({ fromSelectedToken: token })
        return
      }
    }

    // Back to a form kept from before, e.g. after a visit to Swap & Bridge: today's price may
    // have moved since
    if (!isSessionAlreadyOpen && this.fromSelectedToken && this.toSelectedToken) {
      this.#scheduleMarketQuoteUpdate()
    }

    if (!this.fromSelectedToken) {
      await this.#selectDefaultFromToken()
      return
    }

    this.emitUpdate()
  }

  /**
   * Called when a screen with the form closes. The form itself is kept, so it's still there
   * when the user comes back from Swap & Bridge or My orders; see `#onViewLeftTradeRoutes`
   */
  unloadScreen(sessionId: string) {
    this.sessionIds = this.sessionIds.filter((id) => id !== sessionId)
    if (!this.sessionIds.length) this.#updateMarketQuoteInterval.stop()
    this.emitUpdate()
  }

  /** Clears the form once no view shows a trade screen anymore */
  #onViewLeftTradeRoutes(viewId: string) {
    const wasOnTradeRoute = this.#viewIdsOnTradeRoutes.delete(viewId)
    if (!wasOnTradeRoute || this.#viewIdsOnTradeRoutes.size) return
    // A transaction being signed keeps the form it was built from
    if (this.isSignAndBroadcastInProgress) return

    this.sessionIds = []
    this.resetForm()
    this.emitUpdate()
  }

  async updateForm(props: {
    fromAmount?: string
    fromSelectedToken?: TokenResult | null
    toSelectedToken?: SwapAndBridgeToToken | null
    expiry?: LimitOrderExpiry
  }) {
    const { fromAmount, fromSelectedToken, toSelectedToken, expiry } = props
    const previousChainId = this.fromChainId
    this.lastPlacedOrderUid = null

    if (fromSelectedToken !== undefined) {
      const isSupportedNetwork =
        !fromSelectedToken || this.supportedChainIds.includes(Number(fromSelectedToken.chainId))
      if (!isSupportedNetwork) {
        this.emitError({
          level: 'major',
          message: 'Limit orders are not available on this network yet.',
          error: new SwapAndBridgeError('Limit orders are not supported on this network.')
        })
        return
      }
      this.fromSelectedToken = fromSelectedToken
    }
    if (fromAmount !== undefined) this.fromAmount = fromAmount
    if (toSelectedToken !== undefined) this.toSelectedToken = toSelectedToken
    if (expiry !== undefined) this.expiry = expiry

    // Limit orders stay on one network, so a sell token on another network clears what the
    // user receives
    const hasNetworkChanged = this.fromChainId !== previousChainId
    if (hasNetworkChanged) {
      this.toSelectedToken = null
      this.toTokenSearchTerm = ''
      this.toTokenSearchResults = []
      this.#deriveToTokens()
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateToTokenList()
    }

    const hasPairOrAmountChanged =
      fromSelectedToken !== undefined || toSelectedToken !== undefined || fromAmount !== undefined
    if (hasPairOrAmountChanged) {
      // A price typed for another pair means nothing for this one
      if (fromSelectedToken !== undefined || toSelectedToken !== undefined) {
        this.price = DEFAULT_LIMIT_ORDER_PRICE
        this.priceView = null
      }
      this.#scheduleMarketQuoteUpdate()
    }

    this.emitUpdate()
  }

  setPrice(price: LimitOrderPrice) {
    this.price =
      price.mode === 'relative'
        ? { mode: 'relative', bps: Math.min(Math.max(Math.round(price.bps), 0), MAX_COST_VIEW_BPS) }
        : { mode: 'absolute', amount: price.amount }
    this.lastPlacedOrderUid = null
    this.emitUpdate()
  }

  /** Shows the price the other way around and converts a typed price to it */
  flipPriceView() {
    const currentView = this.priceView ?? 'cost'
    const nextView: LimitOrderPriceView = currentView === 'cost' ? 'get' : 'cost'

    if (this.price.mode === 'absolute') {
      const typedPrice = Number(this.price.amount)
      this.price =
        Number.isFinite(typedPrice) && typedPrice > 0
          ? { mode: 'absolute', amount: toPlainDecimalString(1 / typedPrice) }
          : DEFAULT_LIMIT_ORDER_PRICE
    }

    this.priceView = nextView
    this.emitUpdate()
  }

  /**
   * Turns the receive token into the sell token and the other way around. Only possible when the
   * account holds the receive token, as it's what gets sold
   */
  async switchFromAndToTokens() {
    const fromToken = this.fromSelectedToken
    const toToken = this.toSelectedToken
    if (!fromToken || !toToken) return

    const nextFromToken = this.#selectedAccount.portfolio.tokens.find(
      (t) =>
        t.chainId === BigInt(toToken.chainId) &&
        t.address.toLowerCase() === toToken.address.toLowerCase() &&
        !t.flags.onGasTank &&
        !t.flags.rewardsType &&
        getTokenAmount(t) > 0n
    )
    if (!nextFromToken) {
      this.emitError({
        level: 'major',
        message: `You don't have any ${toToken.symbol} to sell.`,
        error: new SwapAndBridgeError('The receive token is not in the portfolio.')
      })
      return
    }

    this.fromSelectedToken = nextFromToken
    this.toSelectedToken = convertPortfolioTokenToSwapAndBridgeToToken(
      fromToken,
      Number(fromToken.chainId)
    )
    this.fromAmount = ''
    this.price = DEFAULT_LIMIT_ORDER_PRICE
    this.priceView = null
    this.marketQuote = null
    // Drops the answer of a price request for the previous pair
    this.#scheduleMarketQuoteUpdate()
    this.#deriveToTokens()
    this.emitUpdate()
  }

  #scheduleMarketQuoteUpdate() {
    if (this.#marketQuoteDebounce) clearTimeout(this.#marketQuoteDebounce)
    // Drops the answer of a request in progress, as it's for the previous form
    this.#marketQuoteRequestId++

    if (!this.fromSelectedToken || !this.toSelectedToken || !this.#sellAmount) {
      this.#updateMarketQuoteInterval.stop()
      this.marketQuoteStatus = 'INITIAL'
      this.marketQuoteError = null
      return
    }

    this.marketQuoteStatus = 'LOADING'
    this.#marketQuoteDebounce = setTimeout(() => {
      this.#marketQuoteDebounce = null
      this.#updateMarketQuoteInterval.restart({ runImmediately: true })
    }, MARKET_QUOTE_DEBOUNCE_MS)
  }

  async #continuouslyUpdateMarketQuote() {
    const shouldUpdate =
      !!this.sessionIds.length &&
      !this.hasProceeded &&
      !!this.fromSelectedToken &&
      !!this.toSelectedToken &&
      !!this.#sellAmount &&
      !this.#isSameToken

    if (!shouldUpdate) {
      this.#updateMarketQuoteInterval.stop()
      return
    }

    await this.#updateMarketQuote()
  }

  async #updateMarketQuote() {
    const account = this.#selectedAccount.account
    const fromToken = this.fromSelectedToken
    const toToken = this.toSelectedToken
    const sellAmount = this.#sellAmount
    const chainId = this.fromChainId
    if (!account || !fromToken || !toToken || !sellAmount || !chainId) return

    this.#marketQuoteRequestId++
    const requestId = this.#marketQuoteRequestId
    this.marketQuoteStatus = 'LOADING'
    this.emitUpdate()

    try {
      const { buyAmount, buyAmountBeforeFees, networkFee, protocolFeeBps, quoteId } =
        await this.#cowSwapApi.getLimitOrderMarketQuote({
          chainId,
          // The native token is sold as its wrapped version, see #placeOrder
          sellToken: this.#getOrderSellTokenAddress(fromToken.address, chainId),
          buyToken: toToken.address,
          sellAmount,
          owner: account.addr,
          feeBps: this.#feeBps
        })
      if (requestId !== this.#marketQuoteRequestId) return

      this.marketQuote = {
        chainId,
        sellTokenAddress: fromToken.address,
        buyTokenAddress: toToken.address,
        sellAmount: sellAmount.toString(),
        buyAmount: buyAmount.toString(),
        buyAmountBeforeFees: buyAmountBeforeFees.toString(),
        networkFee: networkFee.toString(),
        protocolFeeBps,
        quoteId,
        fetchedAt: Date.now()
      }
      this.marketQuoteStatus = 'INITIAL'
      this.marketQuoteError = null
      if (!this.priceView) this.priceView = this.#getReadablePriceView()
    } catch (error: any) {
      if (requestId !== this.#marketQuoteRequestId) return

      const { message } = getHumanReadableSwapAndBridgeError(error)
      this.marketQuoteStatus = 'ERROR'
      this.marketQuoteError = message
      this.emitError({ level: 'silent', message, error })
    }

    this.emitUpdate()
  }

  /**
   * The view whose price is 1 or more, which is easier to read: "1 WETH costs 1,746 USDC"
   * rather than "1 USDC gets you 0.00057 WETH", and "1 WBTC gets you 53.42 WETH" rather than
   * "1 WETH costs 0.0187 WBTC"
   */
  #getReadablePriceView(): LimitOrderPriceView {
    const quote = this.marketQuote
    const fromToken = this.fromSelectedToken
    const toToken = this.toSelectedToken
    if (!quote || !fromToken || !toToken) return 'cost'

    const sellAmount = Number(formatUnits(quote.sellAmount, fromToken.decimals))
    const buyAmount = Number(formatUnits(quote.buyAmountBeforeFees, toToken.decimals))
    if (!buyAmount) return 'cost'

    return sellAmount / buyAmount >= 1 ? 'cost' : 'get'
  }

  /* ---------------------------- "To" token list ---------------------------- */

  /** Builds the "to" token list of the selected network from CoW Swap's list and the portfolio */
  #deriveToTokens() {
    const chainId = this.fromChainId
    if (!chainId) {
      this.#toTokens = []
      return
    }

    const toTokenList = this.#toTokenLists.get(chainId)
    const apiTokens = toTokenList?.apiTokens || addCustomTokensIfNeeded({ chainId, tokens: [] })
    const apiTokenAddresses = new Set(apiTokens.map((t) => t.address.toLowerCase()))
    const addedTokens = (toTokenList?.addedTokens || []).filter(
      (t) => !apiTokenAddresses.has(t.address.toLowerCase())
    )
    const knownAddresses = new Set([
      ...apiTokenAddresses,
      ...addedTokens.map((t) => t.address.toLowerCase())
    ])
    const chainIdBigInt = BigInt(chainId)
    const portfolioTokens = this.#selectedAccount.portfolio.tokens.filter(
      (t) => t.chainId === chainIdBigInt && !t.flags.onGasTank && !t.flags.rewardsType
    )
    const portfolioOnlyTokens = portfolioTokens
      .filter((t) => !knownAddresses.has(t.address.toLowerCase()))
      .map((t) => convertPortfolioTokenToSwapAndBridgeToToken(t, chainId))
    const bannedAddresses = new Set(
      getBannedToTokenList(chainId.toString()).map((address) => address.toLowerCase())
    )
    const tokens = [...apiTokens, ...addedTokens, ...portfolioOnlyTokens].filter(
      (t) => !bannedAddresses.has(t.address.toLowerCase())
    )

    // Only the tokens the account can trade move up, the same ones the select lists as the
    // account's. A debt token, say, stays in its place in the list
    this.#toTokens = sortTokenListResponse(
      tokens,
      portfolioTokens.filter((t) => getIsTokenEligibleForSwapAndBridge(t))
    )
    this.#toTokensPortfolioSignature = this.#getToTokensPortfolioSignature()
  }

  /** The first tokens of the "to" token list, without the token being sold */
  get toTokenShortList(): SwapAndBridgeToToken[] {
    const fromAddress = this.fromSelectedToken?.address.toLowerCase()
    const shortList: SwapAndBridgeToToken[] = []

    // Stops at the limit instead of filtering the whole list, as it runs on every update
    for (let i = 0; i < this.#toTokens.length && shortList.length < TO_TOKEN_LIST_LIMIT; i++) {
      const token = this.#toTokens[i]!
      if (token.address.toLowerCase() !== fromAddress) shortList.push(token)
    }

    return shortList
  }

  async updateToTokenList() {
    const chainId = this.fromChainId
    if (!chainId) return

    const cachedList = this.#toTokenLists.get(chainId)
    const isFresh =
      !!cachedList?.apiTokens.length &&
      Date.now() - cachedList.fetchedAt < TO_TOKEN_LIST_CACHE_THRESHOLD
    if (isFresh) {
      this.#deriveToTokens()
      this.emitUpdate()
      return
    }

    this.isTokenListLoading = true
    this.toTokenListError = null
    this.emitUpdate()

    try {
      // Ordered once here, as CoW Swap's list is sorted by address and runs to thousands of tokens
      const apiTokens = sortCowSwapTokensByPopularity(
        await this.#cowSwapApi.getToTokenList({ fromChainId: chainId, toChainId: chainId }),
        chainId
      )
      this.#toTokenLists.set(chainId, {
        apiTokens,
        addedTokens: cachedList?.addedTokens || [],
        fetchedAt: Date.now()
      })
    } catch (error: any) {
      const { message } = getHumanReadableSwapAndBridgeError(error)
      this.toTokenListError = message
      this.emitError({ level: 'silent', message, error })
    }

    // The network may have changed while the list was loading
    if (chainId === this.fromChainId) {
      this.isTokenListLoading = false
      this.#deriveToTokens()
      if (this.toTokenSearchTerm) this.#updateToTokenSearchResults()
    }
    this.emitUpdate()
  }

  searchToToken(searchTerm: string) {
    this.toTokenSearchTerm = searchTerm.trim().toLowerCase()
    this.#updateToTokenSearchResults()
    this.emitUpdate()
  }

  #updateToTokenSearchResults() {
    const searchTerm = this.toTokenSearchTerm
    if (!searchTerm) {
      this.toTokenSearchResults = []
      return
    }

    const fromAddress = this.fromSelectedToken?.address.toLowerCase()
    const exactMatches: SwapAndBridgeToToken[] = []
    const partialMatches: SwapAndBridgeToToken[] = []

    this.#toTokens.forEach((token) => {
      const address = token.address.toLowerCase()
      if (address === fromAddress) return

      const fields = [address, token.symbol.toLowerCase(), token.name.toLowerCase()]
      if (fields.includes(searchTerm)) exactMatches.push(token)
      else if (fields.some((field) => field.includes(searchTerm))) partialMatches.push(token)
    })

    this.toTokenSearchResults = [...exactMatches, ...partialMatches].slice(0, TO_TOKEN_LIST_LIMIT)
  }

  async addToTokenByAddress(address: string) {
    await this.withStatus('addToTokenByAddress', async () => this.#addToTokenByAddress(address))
  }

  async #addToTokenByAddress(address: string) {
    const chainId = this.fromChainId
    if (!chainId || !isAddress(address)) return

    const isAlreadyListed = this.#toTokens.some(
      (t) => t.address.toLowerCase() === address.toLowerCase()
    )
    if (isAlreadyListed) return

    let token: SwapAndBridgeToToken | null
    try {
      token = await this.#getSupportedTokenByAddress(address, chainId)
    } catch (error: any) {
      const { message } = getHumanReadableSwapAndBridgeError(error)
      throw new EmittableError({ error, level: 'silent', message })
    }
    if (!token) {
      throw new EmittableError({
        level: 'silent',
        message: 'CoW Swap does not support this token.',
        error: new SwapAndBridgeError('The token is not supported by CoW Swap.')
      })
    }
    if (chainId !== this.fromChainId) return

    const list = this.#toTokenLists.get(chainId) ?? { apiTokens: [], addedTokens: [], fetchedAt: 0 }
    list.addedTokens.push(token)
    this.#toTokenLists.set(chainId, list)
    this.#deriveToTokens()
    this.#updateToTokenSearchResults()
    this.emitUpdate()
  }

  /** A token CoW Swap can trade, even if it's missing from its token list */
  async #getSupportedTokenByAddress(
    address: string,
    chainId: number
  ): Promise<SwapAndBridgeToToken | null> {
    const listedToken = await this.#cowSwapApi.getToken({ address, chainId })
    if (listedToken) return listedToken

    const isSupported = await this.#cowSwapApi.isTokenSupported({ address, chainId })
    if (!isSupported) return null

    const network = this.#networks.networks.find((n) => Number(n.chainId) === chainId)
    const provider = this.#providers.providers[chainId.toString()]
    if (!network || !provider) return null

    const token = await getTokenMetaViaRPC({ provider, network, address })

    return token
      ? { ...convertPortfolioTokenToSwapAndBridgeToToken(token, chainId), unverified: true }
      : null
  }

  /* ------------------------------ Placing ------------------------------ */

  async placeOrder() {
    await this.withStatus('placeOrder', async () => this.#placeOrder())
  }

  async #placeOrder() {
    // Not `formStatus`, which is PLACING while this runs
    if (this.hasProceeded || this.#getFormFieldsStatus() !== 'READY') return

    const account = this.#selectedAccount.account
    const fromToken = this.fromSelectedToken
    const toToken = this.toSelectedToken
    const sellAmount = this.#sellAmount
    const buyAmount = this.#targetBuyAmount
    const marketQuote = this.#currentMarketQuote
    const chainId = this.fromChainId
    if (!account || !fromToken || !toToken || !sellAmount || !buyAmount || !chainId) return

    const { network, provider } = this.#getNetworkAndProvider(chainId)
    // The native token is wrapped in the same transaction and the order sells the wrapped
    // version, like any token. CoW Swap's ETH-flow contract isn't used for new orders
    const isNativeSold = fromToken.address.toLowerCase() === ZeroAddress.toLowerCase()
    const sellTokenAddress = this.#getOrderSellTokenAddress(fromToken.address, chainId)

    const { fullAppData, appDataHash } = buildLimitOrderAppData({ feeBps: this.#feeBps })
    const order: CowSwapOrderCreation = {
      sellToken: sellTokenAddress,
      buyToken: normalizeBuyTokenAddress(toToken.address),
      receiver: account.addr,
      sellAmount: sellAmount.toString(),
      buyAmount: buyAmount.toString(),
      validTo: Math.floor(Date.now() / 1000) + COWSWAP_LIMIT_ORDER_EXPIRY_SECONDS[this.expiry],
      appData: fullAppData,
      appDataHash,
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: true,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      signingScheme: 'presign',
      signature: '0x',
      from: account.addr,
      quoteId: marketQuote?.quoteId ?? null
    }
    const orderUid = computeOrderUid({ chainId, order, owner: account.addr, isEthFlow: false })
    // The form or the account may change while the order is being prepared
    const isStale = () =>
      this.#selectedAccount.account?.addr !== account.addr || this.fromSelectedToken !== fromToken

    // Open orders that sell the same token keep needing its allowance until they fill, so the
    // allowance must cover them and this one together. Fetched fresh, as My orders may not have
    // been opened
    let openOrdersSellAmount: bigint
    try {
      openOrdersSellAmount = await this.#getOpenOrdersSellAmount({
        chainId,
        owner: account.addr,
        sellToken: order.sellToken
      })
    } catch (error: any) {
      const { message } = getHumanReadableSwapAndBridgeError(error)
      throw new EmittableError({
        level: 'major',
        message: `Unable to check your other orders. ${message}`,
        error
      })
    }
    if (isStale()) return

    try {
      await this.#cowSwapApi.submitLimitOrder({ chainId, order, orderUid, isEthFlow: false })
    } catch (error: any) {
      const { message } = getHumanReadableSwapAndBridgeError(error)
      throw new EmittableError({ level: 'major', message, error })
    }
    if (isStale()) return

    const userTx: SwapAndBridgeSendTxRequest = {
      activeRouteId: orderUid,
      approvalData: {
        allowanceTarget: COWSWAP_VAULT_RELAYER_ADDRESS,
        approvalTokenAddress: order.sellToken,
        minimumApprovalAmount: (sellAmount + openOrdersSellAmount).toString(),
        owner: account.addr
      },
      chainId,
      txTarget: COWSWAP_SETTLEMENT_ADDRESS,
      userTxIndex: 0,
      value: '0',
      txData: settlementInterface.encodeFunctionData('setPreSignature', [orderUid, true]),
      cowSwapOrder: getCowSwapOrderStruct(order)
    }

    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      account.addr,
      BigInt(chainId)
    )
    if (!accountState) {
      throw new EmittableError({
        level: 'major',
        message: 'Unable to load your account details. Please try again.',
        error: new SwapAndBridgeError('Missing account state for a limit order.')
      })
    }
    // The builder marks its calls with `activeRouteId`, which tells the activity a swap apart.
    // A limit order isn't one
    const orderCalls = (await getSwapAndBridgeCalls(userTx, account, provider, accountState)).map(
      (call) => ({ ...call, activeRouteId: undefined })
    )
    if (isStale()) return
    // Wrapping comes first, so the token permission and the order find the wrapped token
    const calls: Call[] = isNativeSold
      ? [
          {
            id: `${orderUid}-wrap`,
            to: sellTokenAddress,
            value: sellAmount,
            data: wrappedNativeTokenInterface.encodeFunctionData('deposit')
          },
          ...orderCalls
        ]
      : orderCalls

    if (account.safeCreation) {
      const placeCall = calls.find((call) => call.id === orderUid)
      if (placeCall) {
        this.#callsSentToWindow.set(LimitOrdersController.#getSentCallKey(chainId, placeCall), {
          orderUid,
          purpose: 'place'
        })
      }
      await this.#signInWindow({ account, network, calls })
      // Shown as placing once the Safe's owners sign it and it's sent, see `onAccountOpBroadcast`
      this.#resetFormFields()
      this.emitUpdate()
      return
    }

    const isInitialized = await this.#initSignAccountOp({
      purpose: 'place',
      account,
      calls,
      network,
      provider,
      // The call that places the order, as opposed to the token permission before it
      mainCallId: orderUid,
      onBroadcasted: () => {
        this.#rememberAccountWithOrders(account.addr)
        this.#placingOrderUids.add(orderUid)
        // So a fill is noticed even if the order is first listed after it filled
        this.#executedBuyAmounts.set(orderUid, 0n)
        this.lastPlacedOrderUid = orderUid
      }
    })
    if (!isInitialized || isStale()) return

    this.hasProceeded = true
    this.emitUpdate()
  }

  /**
   * How much of `sellToken` the account's open limit orders still sell on `chainId`, so a new
   * order's token permission covers them too
   */
  async #getOpenOrdersSellAmount({
    chainId,
    owner,
    sellToken
  }: {
    chainId: number
    owner: string
    sellToken: string
  }): Promise<bigint> {
    const orders = await this.#cowSwapApi.getAccountLimitOrders({ chainId, owner })

    return orders.reduce((total, order) => {
      const isWaiting = order.status === 'open' || this.#placingOrderUids.has(order.uid)
      if (!isWaiting || order.ethflowData) return total
      if (order.sellToken.toLowerCase() !== sellToken.toLowerCase()) return total

      const remaining = BigInt(order.sellAmount) - BigInt(order.executedSellAmount)

      return remaining > 0n ? total + remaining : total
    }, 0n)
  }

  /**
   * The token the order sells: the wrapped native token in place of the native one, as orders
   * sell tokens, not the native token. Throws on a network without a wrapped native token
   */
  #getOrderSellTokenAddress(fromTokenAddress: string, chainId: number): string {
    if (fromTokenAddress.toLowerCase() !== ZeroAddress.toLowerCase()) return fromTokenAddress

    const wrappedNativeTokenAddress = getWrappedNativeTokenAddress(chainId)
    if (!wrappedNativeTokenAddress) {
      throw new EmittableError({
        level: 'major',
        message: 'Limit orders can’t sell the native token on this network.',
        error: new SwapAndBridgeError('No wrapped native token for a limit order.')
      })
    }

    return wrappedNativeTokenAddress
  }

  /** Hands the calls to the signing window, where Safe accounts sign */
  async #signInWindow({
    account,
    network,
    calls
  }: {
    account: Account
    network: Network
    calls: Call[]
  }) {
    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      account.addr,
      network.chainId
    )
    if (!accountState) {
      throw new EmittableError({
        level: 'major',
        message: 'Unable to load your account details. Please try again.',
        error: new SwapAndBridgeError('Missing account state for a limit order.')
      })
    }
    const baseAcc = getBaseAccount(
      account,
      accountState,
      network,
      this.#featureFlags.isFeatureEnabled('erc4337'),
      this.#featureFlags.isFeatureEnabled('eip7702')
    )

    await this.#requestSignatureInWindow({
      calls,
      meta: {
        accountAddr: account.addr,
        chainId: network.chainId,
        paymasterService: getAmbirePaymasterService(baseAcc, this.#relayerUrl)
      }
    })
    this.signRequestsInWindowCount++
  }

  #getNetworkAndProvider(chainId: number): { network: Network; provider: RPCProvider } {
    const network = this.#networks.networks.find((n) => Number(n.chainId) === chainId)
    const provider = this.#providers.providers[chainId.toString()]
    if (!network || !provider) {
      throw new EmittableError({
        level: 'major',
        message: 'This network is not available right now. Please try again.',
        error: new SwapAndBridgeError(`Missing network or provider for chain ${chainId}.`)
      })
    }

    return { network, provider }
  }

  /**
   * Prepares the transaction to sign. Returns false if the selected account changed meanwhile,
   * as the transaction was built for the previous one
   */
  async #initSignAccountOp({
    purpose,
    account,
    calls,
    network,
    provider,
    mainCallId,
    onBroadcasted
  }: {
    purpose: LimitOrderSignPurpose
    account: Account
    calls: Call[]
    network: Network
    provider: RPCProvider
    /** The call that does what the transaction is for. Without it, nothing was done */
    mainCallId: string
    onBroadcasted: () => void
  }): Promise<boolean> {
    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      account.addr,
      network.chainId
    )
    if (!accountState) {
      throw new EmittableError({
        level: 'major',
        message: 'Unable to load your account details. Please try again.',
        error: new SwapAndBridgeError('Missing account state for a limit order.')
      })
    }
    if (this.#selectedAccount.account?.addr !== account.addr) return false

    this.#destroySignAccountOp()

    const baseAcc = getBaseAccount(
      account,
      accountState,
      network,
      this.#featureFlags.isFeatureEnabled('erc4337'),
      this.#featureFlags.isFeatureEnabled('eip7702')
    )
    const accountOp: AccountOp = {
      id: generateUuid(),
      accountAddr: account.addr,
      chainId: network.chainId,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      // A Safe transaction is queued after the ones this device sent that the RPC may not count
      // yet, instead of taking (and replacing) the nonce of one of them
      nonce: account.safeCreation
        ? this.#activity.getNextNonce(account.addr, network.chainId, 'account', accountState.nonce)
        : accountState.nonce,
      signature: null,
      calls,
      meta: {
        paymasterService: getAmbirePaymasterService(baseAcc, this.#relayerUrl)
      }
    }

    await this.#signAccountOpPreference.initialLoadPromise
    const signAccountOpController = new SignAccountOpController({
      type: 'one-click-limit-order',
      callRelayer: this.#callRelayer,
      accounts: this.#accounts,
      networks: this.#networks,
      keystore: this.#keystore,
      portfolio: this.#portfolio,
      featureFlags: this.#featureFlags,
      platform: this.#platform,
      signAccountOpPreference: this.#signAccountOpPreference,
      externalSignerControllers: this.#externalSignerControllers,
      activity: this.#activity,
      account,
      network,
      provider,
      phishing: this.#phishing,
      dapps: this.#dapps,
      erc7730: this.#erc7730,
      contractInfo: this.#contractInfo,
      fromRequestId: randomId(), // the account op and the request are fabricated
      accountOp,
      shouldSimulate: false,
      onBroadcastSuccess: async (props) => {
        // A basic account sends the token permission and the order as separate transactions.
        // If only the permission went out, the order isn't placed (or cancelled) yet
        const wasMainCallSent = props.submittedAccountOp.calls.some(
          (call) => call.id === mainCallId
        )
        if (wasMainCallSent) {
          onBroadcasted()
        } else {
          this.#hasPartiallyBroadcast = true
          this.emitError({
            level: 'major',
            message:
              'Only the token permission was sent, so the order isn’t placed yet. Please place it again.',
            error: new SwapAndBridgeError('The limit order call was not broadcast.')
          })
        }
        this.#portfolio
          .simulateAccountOp(props.accountOp)
          .then(() => {
            this.#portfolio.markSimulationAsBroadcasted(accountOp.accountAddr, accountOp.chainId)
          })
          .catch((error) => {
            this.emitError({ level: 'silent', message: 'Limit order simulation failed', error })
          })

        await this.#onBroadcastSuccess(props)
      },
      onBroadcastFailed: this.#onBroadcastFailed
    })
    this.#signAccountOpController = signAccountOpController
    this.signAccountOpPurpose = purpose

    signAccountOpController.onUpdate((forceEmit) => {
      this.propagateUpdate(forceEmit)

      if (signAccountOpController.broadcastStatus === 'SUCCESS') {
        // On the next tick, so the UI gets the final update of the controller before it's
        // destroyed
        setTimeout(() => this.#onSignAccountOpBroadcasted(signAccountOpController), 0)
      }
    }, 'limit-orders')
    signAccountOpController.onError(async (error) => {
      // Forwarded as is, as SignAccountOp already decides how loud each of its errors is
      this.emitError(error)
      await this.#portfolio.overrideSimulationResults(signAccountOpController.accountOp)
    })

    return true
  }

  #onSignAccountOpBroadcasted(signAccountOpController: SignAccountOpController) {
    // A newer transaction replaced it in the meantime
    if (this.#signAccountOpController !== signAccountOpController) return

    const purpose = this.signAccountOpPurpose
    const hasPartiallyBroadcast = this.#hasPartiallyBroadcast
    this.#hasPartiallyBroadcast = false
    this.#destroySignAccountOp()
    // A partly sent order keeps its form, so the user can place it again
    if (purpose === 'place' && !hasPartiallyBroadcast) this.#resetFormFields()

    this.#rebuildOrders()
    this.emitUpdate()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.updateOrders()
  }

  async callSignAccountOpMethod<M extends keyof SignAccountOpControllerMethods>(
    method: M,
    args: Parameters<SignAccountOpControllerMethods[M]>
  ) {
    if (!this.#signAccountOpController) return

    await (this.#signAccountOpController[method] as any)(...args)
  }

  setUserProceeded(hasProceeded: boolean) {
    this.hasProceeded = hasProceeded
    this.emitUpdate()
  }

  /**
   * Drops the transaction being prepared, e.g. when the user closes the signing modal. A placed
   * order whose transaction was never sent stays inactive at CoW Swap until it expires
   */
  destroySignAccountOp() {
    this.#destroySignAccountOp()
    // The price stopped refreshing while the transaction was being signed
    if (this.sessionIds.length && this.fromSelectedToken && this.toSelectedToken) {
      this.#scheduleMarketQuoteUpdate()
    }
    this.emitUpdate()
  }

  /** Drops the transaction being prepared, without an update. The caller emits one */
  #destroySignAccountOp() {
    if (this.#signAccountOpController) {
      this.#signAccountOpController.destroy()
      this.#signAccountOpController = null
    }
    this.signAccountOpPurpose = null
    this.hasProceeded = false
  }

  cancelSignReq() {
    this.#signAccountOpController?.cancelSignReq()
  }

  /** Hides the confirmation of the order the user just placed */
  dismissPlacedOrder() {
    this.lastPlacedOrderUid = null
    this.emitUpdate()
  }

  /* ----------------------------- Cancelling ----------------------------- */

  async cancelOrder(orderUid: string) {
    await this.withStatus('cancelOrder', async () => this.#cancelOrder(orderUid))
  }

  async #cancelOrder(orderUid: string) {
    const order = [...this.#accountOrders.values()]
      .flat()
      .find((o) => o.uid.toLowerCase() === orderUid.toLowerCase())
    const listedOrder = this.orders.find((o) => o.uid.toLowerCase() === orderUid.toLowerCase())
    if (!order || !listedOrder) {
      throw new EmittableError({
        level: 'major',
        message: 'This order is no longer in your list. Refresh My orders and try again.',
        error: new SwapAndBridgeError('The order to cancel was not found.')
      })
    }
    const cancellableStatuses: LimitOrderStatus[] = ['open', 'partiallyFilled', 'rejected']
    if (!cancellableStatuses.includes(listedOrder.status)) {
      throw new EmittableError({
        level: 'major',
        message: 'Only orders that are still waiting can be cancelled.',
        error: new SwapAndBridgeError(`Cannot cancel an order with status ${listedOrder.status}.`)
      })
    }

    const { network, provider } = this.#getNetworkAndProvider(listedOrder.chainId)
    const call = this.#getCancelCall(order)
    if (!call) {
      throw new EmittableError({
        level: 'major',
        message: 'Unable to cancel this order. Please try again later.',
        error: new SwapAndBridgeError('Missing the ETH-flow data of the order to cancel.')
      })
    }

    const account = this.#selectedAccount.account
    if (!account) return

    if (account.safeCreation) {
      this.#callsSentToWindow.set(LimitOrdersController.#getSentCallKey(listedOrder.chainId, call), {
        orderUid: order.uid,
        purpose: 'cancel'
      })
      await this.#signInWindow({ account, network, calls: [call] })
      // Shown as cancelling once the Safe's owners sign it and it's sent, see `onAccountOpBroadcast`
      return
    }

    const isInitialized = await this.#initSignAccountOp({
      purpose: 'cancel',
      account,
      calls: [call],
      network,
      provider,
      mainCallId: `${order.uid}-cancel`,
      onBroadcasted: () => {
        this.#cancellingOrderUids.add(order.uid)
      }
    })
    if (!isInitialized) return

    this.hasProceeded = true
    this.emitUpdate()
  }

  #getCancelCall(order: CowSwapAccountOrder): Call | null {
    if (order.ethflowData) {
      const ethFlowOrderData = getEthFlowOrderData(order)
      if (!ethFlowOrderData) return null

      return {
        id: `${order.uid}-cancel`,
        to: COWSWAP_ETH_FLOW_ADDRESS,
        value: 0n,
        data: ethFlowInterface.encodeFunctionData('invalidateOrder', [ethFlowOrderData])
      }
    }

    // Lets the humanizer show which order gets cancelled, after it checks it matches the ID
    const cowSwapOrder: CowSwapOrderStruct = {
      sellToken: order.sellToken,
      buyToken: order.buyToken,
      receiver: order.receiver || ZeroAddress,
      sellAmount: order.sellAmount,
      buyAmount: order.buyAmount,
      validTo: order.validTo,
      appData: order.appData,
      feeAmount: order.feeAmount,
      kind: order.kind,
      partiallyFillable: order.partiallyFillable,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20'
    }

    return {
      id: `${order.uid}-cancel`,
      to: COWSWAP_SETTLEMENT_ADDRESS,
      value: 0n,
      data: settlementInterface.encodeFunctionData('invalidateOrder', [order.uid]),
      cowSwapOrder
    }
  }

  /* ------------------------------ My orders ------------------------------ */

  async initOrders(sessionId: string) {
    if (!this.ordersSessionIds.includes(sessionId)) this.ordersSessionIds.push(sessionId)

    if (this.ordersAccountAddr !== (this.#selectedAccount.account?.addr ?? null)) {
      this.#clearOrders()
    }
    this.emitUpdate()
    this.#updateOrdersInterval.restart({ runImmediately: true })
  }

  unloadOrders(sessionId: string) {
    this.ordersSessionIds = this.ordersSessionIds.filter((id) => id !== sessionId)
    if (!this.ordersSessionIds.length) this.#updateOrdersInterval.stop()
  }

  async #continuouslyUpdateOrders() {
    if (!this.ordersSessionIds.length) {
      this.#updateOrdersInterval.stop()
      return
    }

    await this.updateOrders()
  }

  /**
   * Refreshes My orders. Not wrapped in `withStatus`, which would turn away placing or
   * cancelling an order while it runs, as it does every 30 seconds
   */
  async updateOrders() {
    if (this.#ordersUpdate) return this.#ordersUpdate

    this.isUpdatingOrders = true
    this.emitUpdate()
    this.#ordersUpdate = this.#updateOrders()
      .catch((error) => {
        const { message } = getHumanReadableSwapAndBridgeError(error)
        this.emitError({ level: 'silent', message, error })
      })
      .finally(() => {
        this.#ordersUpdate = null
        this.isUpdatingOrders = false
        this.emitUpdate()
      })

    return this.#ordersUpdate
  }

  async #updateOrders() {
    const account = this.#selectedAccount.account
    if (!account) return

    if (this.ordersAccountAddr !== account.addr) {
      this.#clearOrders()
      this.ordersAccountAddr = account.addr
    }

    const chainIds = this.supportedChainIds.filter((chainId) =>
      this.#networks.networks.some((n) => Number(n.chainId) === chainId)
    )
    const results = await Promise.allSettled(
      chainIds.map(async (chainId) => ({
        chainId,
        orders: await this.#cowSwapApi.getAccountLimitOrders({ chainId, owner: account.addr })
      }))
    )
    // The user switched accounts while the orders were loading
    if (this.#selectedAccount.account?.addr !== account.addr) return

    let failedCount = 0
    const chainIdsWithFills = new Set<number>()
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const { chainId, orders } = result.value
        orders.forEach((order) => {
          const executedBuyAmount = BigInt(order.executedBuyAmount)
          const previous = this.#executedBuyAmounts.get(order.uid)
          // Unknown before (first refresh): nothing to compare with, so no fill is assumed
          if (previous !== undefined && executedBuyAmount > previous) {
            chainIdsWithFills.add(chainId)
          }
          this.#executedBuyAmounts.set(order.uid, executedBuyAmount)
        })
        this.#accountOrders.set(chainId, orders)
        // e.g. orders placed from another device, found when the user opened My orders here
        if (orders.length) this.#rememberAccountWithOrders(account.addr)
        return
      }

      failedCount++
      const { message } = getHumanReadableSwapAndBridgeError(result.reason)
      this.emitError({ level: 'silent', message, error: result.reason })
    })
    this.ordersError =
      failedCount && failedCount === results.length
        ? 'Unable to load your orders right now. We will try again shortly.'
        : null

    // A fill moved tokens in and out of the account, so its balances on that network are stale
    if (chainIdsWithFills.size) {
      this.#portfolioUpdate([...chainIdsWithFills].map((chainId) => BigInt(chainId)))
    }

    await this.#resolveOrderTokens()
    if (this.#selectedAccount.account?.addr !== account.addr) return

    this.#rebuildOrders()
    this.ordersUpdatedAt = Date.now()
    this.emitUpdate()
  }

  #clearOrders() {
    this.#accountOrders.clear()
    this.#executedBuyAmounts.clear()
    this.#placingOrderUids.clear()
    this.#cancellingOrderUids.clear()
    this.#callsSentToWindow.clear()
    this.orders = []
    this.ordersAccountAddr = this.#selectedAccount.account?.addr ?? null
    this.ordersError = null
    this.ordersUpdatedAt = null
  }

  /**
   * Marks the orders placed or cancelled by a broadcast transaction of the signing window. Called
   * for every broadcast transaction, so it ignores the ones that aren't about limit orders
   */
  onAccountOpBroadcast({
    accountAddr,
    chainId,
    calls
  }: {
    accountAddr: string
    chainId: bigint
    calls: Call[]
  }) {
    let hasMarkedOrders = false

    calls.forEach((call) => {
      const key = LimitOrdersController.#getSentCallKey(chainId, call)
      const sentCall = this.#callsSentToWindow.get(key)
      if (!sentCall) return

      this.#callsSentToWindow.delete(key)
      hasMarkedOrders = true
      if (sentCall.purpose === 'cancel') {
        this.#cancellingOrderUids.add(sentCall.orderUid)
        return
      }

      this.#rememberAccountWithOrders(accountAddr)
      this.#placingOrderUids.add(sentCall.orderUid)
      // So a fill is noticed even if the order is first listed after it filled
      this.#executedBuyAmounts.set(sentCall.orderUid, 0n)
    })
    if (!hasMarkedOrders) return

    this.#rebuildOrders()
    this.emitUpdate()
    // A newly placed order isn't among the listed ones yet
    if (this.#selectedAccount.account?.addr === accountAddr) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateOrders()
    }
  }

  /**
   * Identifies a call by what it does, as the signing window may give it a new id. A call that
   * deploys a contract has no `to`, and is never one of ours
   */
  static #getSentCallKey(chainId: bigint | number, call: Pick<Call, 'to' | 'data'>) {
    return `${chainId.toString()}:${(call.to ?? '').toLowerCase()}:${call.data.toLowerCase()}`
  }

  static #getTokenKey(chainId: number, address: string) {
    return `${chainId}:${address.toLowerCase()}`
  }

  /** Finds the symbol and decimals of the tokens of the orders, from the portfolio first */
  async #resolveOrderTokens() {
    const missing = new Map<string, { chainId: number; address: string }>()
    this.#accountOrders.forEach((orders, chainId) => {
      orders.forEach((order) => {
        const addresses = [order.sellToken, order.buyToken]
        addresses.forEach((address) => {
          // The native token isn't a contract to look up, see #getOrderToken
          if (address.toLowerCase() === COWSWAP_BUY_NATIVE_TOKEN_ADDRESS.toLowerCase()) return

          const key = LimitOrdersController.#getTokenKey(chainId, address)
          if (!this.#tokenInfoCache.has(key)) missing.set(key, { chainId, address })
        })
      })
    })
    if (!missing.size) return

    const portfolioTokens = this.#selectedAccount.portfolio.tokens

    await Promise.all(
      [...missing.entries()].map(async ([key, { chainId, address }]) => {
        const portfolioToken = portfolioTokens.find(
          (t) => Number(t.chainId) === chainId && t.address.toLowerCase() === address.toLowerCase()
        )
        if (portfolioToken) {
          this.#tokenInfoCache.set(key, {
            chainId,
            address,
            symbol: portfolioToken.symbol,
            decimals: portfolioToken.decimals
          })
          return
        }

        try {
          const listedToken = await this.#cowSwapApi.getToken({ address, chainId })
          if (listedToken) {
            this.#tokenInfoCache.set(key, {
              chainId,
              address,
              symbol: listedToken.symbol,
              decimals: listedToken.decimals,
              icon: listedToken.icon
            })
            return
          }

          const network = this.#networks.networks.find((n) => Number(n.chainId) === chainId)
          const provider = this.#providers.providers[chainId.toString()]
          if (!network || !provider) return

          const token = await getTokenMetaViaRPC({ provider, network, address })
          if (token) {
            this.#tokenInfoCache.set(key, {
              chainId,
              address,
              symbol: token.symbol,
              decimals: token.decimals
            })
          }
        } catch (error: any) {
          // The order is still shown, with the token's address instead of its symbol
          this.emitError({
            level: 'silent',
            message: 'Unable to load the details of a token in your orders.',
            error
          })
        }
      })
    )
  }

  #getOrderToken(chainId: number, address: string, isNativeSold = false): LimitOrderToken | null {
    // An ETH-flow order sells the native token, and CoW Swap marks a bought native token with
    // a placeholder address
    const isNative =
      isNativeSold || address.toLowerCase() === COWSWAP_BUY_NATIVE_TOKEN_ADDRESS.toLowerCase()
    if (isNative) {
      const network = this.#networks.networks.find((n) => Number(n.chainId) === chainId)

      return {
        chainId,
        address: ZeroAddress,
        symbol: network?.nativeAssetSymbol || 'ETH',
        decimals: 18
      }
    }

    return this.#tokenInfoCache.get(LimitOrdersController.#getTokenKey(chainId, address)) ?? null
  }

  #rebuildOrders() {
    const orders: LimitOrder[] = []

    this.#accountOrders.forEach((accountOrders, chainId) => {
      accountOrders.forEach((order) => {
        const isPlacing = this.#placingOrderUids.has(order.uid)
        const isCancelling = this.#cancellingOrderUids.has(order.uid)
        const status = getOrderStatus({ order, isPlacing, isCancelling })
        if (!status) return

        // Each status the API settles on ends what this session was waiting for
        if (status !== 'placing') this.#placingOrderUids.delete(order.uid)
        if (status !== 'cancelling') this.#cancellingOrderUids.delete(order.uid)

        const isEthFlow = !!order.ethflowData
        const sellToken = this.#getOrderToken(chainId, order.sellToken, isEthFlow)
        const buyToken = this.#getOrderToken(chainId, order.buyToken)
        // Without its decimals, the order's amounts can't be shown correctly
        if (!sellToken || !buyToken) return

        orders.push({
          uid: order.uid,
          chainId,
          status,
          sellToken,
          buyToken,
          sellAmount: order.sellAmount,
          buyAmount: order.buyAmount,
          executedSellAmount: order.executedSellAmount,
          executedBuyAmount: order.executedBuyAmount,
          validTo: order.ethflowData?.userValidTo ?? order.validTo,
          createdAt: new Date(order.creationDate).getTime(),
          isEthFlow,
          partiallyFillable: order.partiallyFillable,
          feeBps: getPartnerFeeBpsFromAppData(order.fullAppData)
        })
      })
    })

    this.orders = orders.sort((a, b) => b.createdAt - a.createdAt)
  }

  /* -------------------------------- Reset -------------------------------- */

  #resetFormFields() {
    this.fromAmount = ''
    this.price = DEFAULT_LIMIT_ORDER_PRICE
    this.priceView = null
    this.marketQuote = null
    this.marketQuoteStatus = 'INITIAL'
    this.marketQuoteError = null
    this.#marketQuoteRequestId++
    if (this.#marketQuoteDebounce) clearTimeout(this.#marketQuoteDebounce)
    this.#marketQuoteDebounce = null
    this.#updateMarketQuoteInterval.stop()
  }

  /** Clears the form and drops the transaction being prepared */
  resetForm() {
    this.#resetFormFields()
    this.fromSelectedToken = null
    this.toSelectedToken = null
    this.expiry = '7d'
    this.toTokenSearchTerm = ''
    this.toTokenSearchResults = []
    this.lastPlacedOrderUid = null
    this.#toTokens = []
    this.#destroySignAccountOp()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      fromChainId: this.fromChainId,
      supportedChainIds: this.supportedChainIds,
      maxFromAmount: this.maxFromAmount,
      fromAmountError: this.fromAmountError,
      feeExemptionReason: this.feeExemptionReason,
      triggerBuyAmount: this.triggerBuyAmount,
      targetBuyAmount: this.targetBuyAmount,
      priceError: this.priceError,
      formStatus: this.formStatus,
      signErrors: this.signErrors,
      toTokenShortList: this.toTokenShortList,
      signAccountOpController: this.signAccountOpController,
      isSignAndBroadcastInProgress: this.isSignAndBroadcastInProgress
    }
  }
}
