import { formatUnits, Interface, isAddress, parseUnits, ZeroAddress } from 'ethers'

import EmittableError from '../../classes/EmittableError'
import { RecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout'
import SwapAndBridgeError from '../../classes/SwapAndBridgeError'
import { STK_WALLET } from '../../consts/addresses'
import {
  DEFAULT_LIMIT_ORDER_EXPIRY_DAYS,
  DEFAULT_LIMIT_ORDER_PRICE,
  DEFAULT_LIMIT_ORDER_PRICE_BPS,
  LIMIT_ORDER_MAX_EXPIRY_DAYS
} from '../../consts/limitOrders'
import { getRpcTokenPriceConfig } from '../../consts/rpcTokenPrices'
import { TO_TOKEN_LIST_CACHE_THRESHOLD, TO_TOKEN_LIST_LIMIT } from '../../consts/swapAndBridge'
import { Account, IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { Banner } from '../../interfaces/banner'
import { IContractInfoController } from '../../interfaces/contractInfo'
import { IDappsController } from '../../interfaces/dapp'
import { IErc7730Controller } from '../../interfaces/erc7730'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore'
import {
  LimitOrder,
  LimitOrderFillIssue,
  LimitOrderFormStatus,
  LimitOrderMarketQuote,
  LimitOrderPrice,
  LimitOrderPriceError,
  LimitOrderPriceTypedFor,
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
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
import { getAmbirePaymasterService } from '../../libs/erc7677/erc7677'
import { randomId } from '../../libs/humanizer/utils'
import { formatLimitOrderAmount } from '../../libs/limitOrders/formatAmount'
import { getAccountNetworks } from '../../libs/networks/networks'
import { TokenResult } from '../../libs/portfolio'
import { getTokenMetaViaRPC } from '../../libs/portfolio/getTokenMetaViaRPC'
import { getTokenAmount } from '../../libs/portfolio/helpers'
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
  getOpenLimitOrdersSellAmount,
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
  cancelOrder: 'INITIAL',
  allowAgain: 'INITIAL'
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

/**
 * How often the permission and the balance of the known waiting orders are read again on a
 * balance update at most, when the balances of the tokens they sell didn't change. Catches a
 * permission removed on another site
 */
const FILL_ISSUES_MAX_AGE = 60 * 1000

/** How often My orders is refreshed while it's open */
const ORDERS_UPDATE_INTERVAL = 30 * 1000

/**
 * How often the selected account's orders are refreshed while some of them wait to fill and a
 * wallet screen is open, so a fill shows up soon, e.g. as the dashboard's banner
 */
const WAITING_ORDERS_UPDATE_INTERVAL = 60 * 1000

/** The statuses of the orders that can change without the user, e.g. fill or get confirmed */
const WAITING_ORDER_STATUSES: LimitOrderStatus[] = [
  'placing',
  'open',
  'partiallyFilled',
  'cancelling'
]

/** How long to wait for the user to stop typing before asking for today's price */
const MARKET_QUOTE_DEBOUNCE_MS = 400

/**
 * The routes of the trade screens: Swap & Bridge, the limit order form and My orders. The form
 * is kept while the user moves between them, and cleared once no view shows any of them
 */
const TRADE_ROUTES = ['swap-and-bridge', 'limit-order', 'limit-orders']

const isTradeRoute = (route: string | undefined) => !!route && TRADE_ROUTES.includes(route)

/**
 * How long the orders of a token show as being allowed again at most. A fallback in case the
 * confirmation of the transaction is never reported, so the user can try again
 */
const ALLOWING_AGAIN_MAX_AGE = 10 * 60 * 1000

/** Wraps the native token into its wrapped version, e.g. ETH into WETH */
const wrappedNativeTokenInterface = new Interface(['function deposit() payable'])

/** Reads and sets CoW Swap's permission to use a token, and reads the account's balance */
const erc20Interface = new Interface([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
])

/** See #getAbsoluteTargetBuyAmount */
const PRICE_EXTRA_DECIMALS = 18

/** The highest relative `bps` that keeps the "cost" price above zero */
const MAX_COST_VIEW_BPS = 9900

/**
 * How much, in USD, of the token being sold today's price is asked for before the user enters an
 * amount, so the form shows a price as soon as both tokens are picked. Large enough for the
 * network cost not to skew it, as it would for a few cents
 */
const REFERENCE_QUOTE_USD_VALUE = 1000

/** Networks whose native token is a USD stablecoin, so it's not offered as the "other" token */
const STABLECOIN_NATIVE_CHAIN_IDS = [100]

/** How many significant digits the price taken from today's price is rounded to */
const PRICE_SIGNIFICANT_DIGITS = 6

/** How many significant digits a typed price keeps when the user flips the way it reads */
const FLIPPED_PRICE_SIGNIFICANT_DIGITS = 12

/**
 * What to tell a user whose basic account sent only the first steps of a transaction (e.g. the
 * token permission, or wrapping the native token) and not the one it was for
 */
const PARTIAL_BROADCAST_MESSAGES: Record<LimitOrderSignPurpose, string> = {
  place: 'Only the first steps were sent, so the order isn’t placed yet. Please place it again.',
  cancel: 'The orders weren’t cancelled. Please try again.',
  allow:
    'Only the first step was sent, so your orders still can’t use this token. Please allow it again.'
}

const SECONDS_IN_DAY = 60 * 60 * 24

/** A number as a decimal string without exponent notation, e.g. 0.0000000033 not 3.3e-9 */
const toPlainDecimalString = (value: number) =>
  value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 12 })

/** Rounds a positive number up or down to `digits` significant digits. 0 if it isn't positive */
const roundToSignificantDigits = (value: number, digits: number, direction: 'up' | 'down') => {
  if (!Number.isFinite(value) || value <= 0) return 0

  const scale = 10 ** (digits - 1 - Math.floor(Math.log10(value)))
  const round = direction === 'up' ? Math.ceil : Math.floor

  return round(value * scale) / scale
}

/**
 * The addresses, lowercased and in order of preference, of the token a new form trades the token
 * sold for: the network's main USD stablecoins, or its native token (or the wrapped one) when the
 * token sold is a stablecoin itself
 */
const getDefaultPricedInTokenAddresses = (fromToken: TokenResult): string[] => {
  const chainId = Number(fromToken.chainId)
  const nativeAddress = ZeroAddress.toLowerCase()
  const stablecoins = (
    getRpcTokenPriceConfig(fromToken.chainId)?.spotPrices?.stablecoins ?? []
  ).map((address) => address.toLowerCase())
  const isNativeStablecoin = STABLECOIN_NATIVE_CHAIN_IDS.includes(chainId)
  const fromAddress = fromToken.address.toLowerCase()
  const isFromStablecoin =
    stablecoins.includes(fromAddress) || (isNativeStablecoin && fromAddress === nativeAddress)

  if (!isFromStablecoin) return stablecoins
  if (isNativeStablecoin) return []

  const wrappedNativeAddress = getWrappedNativeTokenAddress(chainId)?.toLowerCase()

  return wrappedNativeAddress ? [nativeAddress, wrappedNativeAddress] : [nativeAddress]
}

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

  /** Refreshes the orders while needed, see `#getOrdersUpdateTimeout` */
  #updateOrdersInterval: RecurringTimeout

  #ui: IUiController

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

  /** See `limitOrdersSeenFills` in the storage */
  #seenFills = new Map<string, Set<string>>()

  /** The last write of `#seenFills`, as writes to the storage must not run in parallel */
  #seenFillsWrite: Promise<unknown> = Promise.resolve()

  /**
   * How much each order of the account had received at the last refresh, to notice when one
   * fills (or fills a part) and refresh the balances it changed
   */
  #executedBuyAmounts = new Map<string, bigint>()

  /** The My orders refresh in progress, which simultaneous refreshes share */
  #ordersUpdate: Promise<void> | null = null

  /** The account whose orders `#ordersUpdate` loads */
  #ordersUpdateAccountAddr: string | null = null

  /** Whether only the token permission of the order being signed was sent */
  #hasPartiallyBroadcast = false

  /** Orders whose cancel transaction was broadcast this session */
  #cancellingOrderUids = new Set<string>()

  /** Why each waiting order of `ordersAccountAddr` can't fill, see `#getFillIssues` */
  #fillIssues = new Map<string, LimitOrderFillIssue>()

  /** When `#fillIssues` were last read */
  #fillIssuesReadAt = 0

  /** Counts the reads of `#fillIssues`, so a check that a newer read overtook is dropped */
  #fillIssuesReadId = 0

  /** The check that runs on a balance update, see `#recheckFillIssuesIfNeeded` */
  #fillIssuesRecheck: Promise<void> | null = null

  /** The balances of the tokens the known waiting orders sell, at the last check */
  #soldTokensBalancesSignature = ''

  /**
   * The calls that place or cancel an order, handed to the signing window (Safe accounts), by
   * `#getSentCallKey`. The user can still reject them there, so the order is shown as placing or
   * cancelling only once its call is broadcast (see `onAccountOpBroadcast`)
   */
  #callsSentToWindow = new Map<string, { orderUid: string; purpose: LimitOrderSignPurpose }>()

  /**
   * The broadcast "allow again" calls that aren't confirmed yet, by `#getSentCallKey`, with the
   * token (`#getTokenKey`) they give the permission for and when they were sent. Its orders show
   * as being allowed again instead of unable to fill until the transaction is confirmed or fails,
   * see `onAccountOpsFinalized`, or for `ALLOWING_AGAIN_MAX_AGE` at most
   */
  #allowingCalls = new Map<string, { tokenKey: string; sentAt: number }>()

  /**
   * The broadcast calls that place or cancel an order and aren't confirmed yet, by
   * `#getSentCallKey`. If their transaction doesn't go through, e.g. the user cancels it while
   * it's stuck, the order is no longer shown as placing or cancelling, see `onAccountOpsFinalized`
   */
  #unconfirmedOrderCalls = new Map<string, { orderUid: string; purpose: 'place' | 'cancel' }>()

  #tokenInfoCache = new Map<string, LimitOrderToken>()

  #lastSelectedAccountAddr: string | null = null

  /** How the user chose to read the price, see `priceView`. Null until it's set for the pair */
  #priceView: LimitOrderPriceView | null = null

  /** Whether the user picked the token received, rather than only the one picked for them */
  #hasUserPickedTokens = false

  /**
   * Whether the user set the price, by typing it or with the arrows. Until then the price follows
   * today's price for the current amount and direction, see `#setPriceFromMarketQuote`
   */
  isPriceTyped: boolean = false

  /**
   * The screens (`sessionIds`) that show the review of the order. The price then stays as
   * reviewed, instead of following today's price, see `#setPriceFromMarketQuote`. By screen, as
   * one screen may review the order while another shows the form, and a closed window can't say
   * it stopped reviewing, see `unloadScreen`
   */
  #reviewingSessionIds = new Set<string>()

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  /** The screens that show the form. The form resets when the last one closes */
  sessionIds: string[] = []

  /**
   * Whether the form was left filled in the popup when it closed. The popup closes as soon as the
   * user clicks outside it, e.g. to check a price elsewhere, so it opens on the Limit screen
   * again, with the form, until the form is shown again or cleared
   */
  hasPersistedPopupForm: boolean = false

  /** The screens that show My orders. My orders refreshes while one is open */
  ordersSessionIds: string[] = []

  /** The tokens the account can sell with a limit order, in the order Swap & Bridge lists them */
  fromTokenList: TokenResult[] = []

  fromSelectedToken: TokenResult | null = null

  /** In human units of `fromSelectedToken` */
  fromAmount: string = ''

  toSelectedToken: SwapAndBridgeToToken | null = null

  /**
   * The price the user set. Starts relative to today's price and turns into a typed one when
   * today's price comes, see `#setPriceFromMarketQuote`
   */
  price: LimitOrderPrice = DEFAULT_LIMIT_ORDER_PRICE

  /** How many days the order stays open */
  expiryDays: number = DEFAULT_LIMIT_ORDER_EXPIRY_DAYS

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
    // The account already selected owns what is tracked from now on, so its first update isn't
    // taken for an account switch and its first orders refresh doesn't drop the orders being
    // placed or cancelled
    this.#lastSelectedAccountAddr = selectedAccount.account?.addr ?? null
    this.ordersAccountAddr = this.#lastSelectedAccountAddr
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
    this.#ui = ui
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
    ui.uiEvent.on('removeView', (view: View) => {
      this.#onViewLeftTradeRoutes(view.id, { isClosedPopup: view.type === 'popup' })
      // Waiting orders are refreshed only while a wallet screen is open
      this.#syncOrdersUpdates()
    })
    ui.uiEvent.on('addView', () => this.#syncOrdersUpdates())
  }

  async #load() {
    try {
      const accounts = await this.#storage.get('limitOrdersAccounts', [])
      accounts.forEach((addr) => this.#accountsWithOrders.add(addr.toLowerCase()))
    } catch (error: any) {
      this.emitError({ level: 'silent', message: 'Failed to load the limit order accounts', error })
    }
    try {
      const seenFills = await this.#storage.get('limitOrdersSeenFills', {})
      Object.entries(seenFills).forEach(([addr, uids]) => {
        this.#seenFills.set(addr.toLowerCase(), new Set(uids))
      })
    } catch (error: any) {
      this.emitError({
        level: 'silent',
        message: 'Failed to load the seen limit order fills',
        error
      })
    }
  }

  #saveSeenFills() {
    const seenFills = Object.fromEntries(
      [...this.#seenFills.entries()].map(([addr, uids]) => [addr, [...uids]])
    )
    this.#seenFillsWrite = this.#seenFillsWrite
      .then(() => this.#storage.set('limitOrdersSeenFills', seenFills))
      .catch((error) => {
        this.emitError({
          level: 'silent',
          message: 'Failed to save the seen limit order fills',
          error
        })
      })
  }

  /**
   * The first time all of the account's orders load, its fills so far count as seen, so the
   * dashboard tells the user only about the orders that fill from then on, not about old ones
   */
  #markFillsSoFarAsSeen(accountAddr: string) {
    const addr = accountAddr.toLowerCase()
    if (this.#seenFills.has(addr)) return

    const filledUids = this.orders
      .filter((order) => order.status === 'filled')
      .map((order) => order.uid)
    this.#seenFills.set(addr, new Set(filledUids))
    this.#saveSeenFills()
  }

  /**
   * Starts telling about the account's fills when it places an order, if its orders never fully
   * loaded. Otherwise its first load would count the new order as seen if it filled before then,
   * e.g. while the wallet was closed. Only Ambire orders are listed, so the fills it doesn't know
   * of can only be of orders it placed with Ambire on another device
   */
  #startSeenFillsOnPlacing(accountAddr: string) {
    const addr = accountAddr.toLowerCase()
    if (this.#seenFills.has(addr)) return

    const areOrdersLoaded =
      this.ordersAccountAddr?.toLowerCase() === addr && this.ordersUpdatedAt !== null
    const filledUids = areOrdersLoaded
      ? this.orders.filter((order) => order.status === 'filled').map((order) => order.uid)
      : []
    this.#seenFills.set(addr, new Set(filledUids))
    this.#saveSeenFills()
  }

  /**
   * The selected account's orders that filled since the user last saw its filled orders. None
   * until all of its orders loaded once, see `#markFillsSoFarAsSeen`
   */
  get #unseenFilledOrders(): LimitOrder[] {
    const accountAddr = this.#selectedAccount.account?.addr
    if (!accountAddr || this.ordersAccountAddr !== accountAddr || this.ordersUpdatedAt === null) {
      return []
    }
    const seenUids = this.#seenFills.get(accountAddr.toLowerCase())
    if (!seenUids) return []

    return this.orders.filter((order) => order.status === 'filled' && !seenUids.has(order.uid))
  }

  /**
   * Tells the user on the dashboard that orders filled since they last looked, as orders usually
   * fill while they're away. Goes away once they see the orders or dismiss it
   */
  get banners(): Banner[] {
    const unseenFilledOrders = this.#unseenFilledOrders
    const accountAddr = this.#selectedAccount.account?.addr
    if (!unseenFilledOrders.length || !accountAddr) return []

    const [order] = unseenFilledOrders
    const isSingle = unseenFilledOrders.length === 1
    // The same digits as My orders, so the user can find the amounts there
    const getAmount = (amount: string, decimals: number) =>
      formatLimitOrderAmount(formatUnits(amount, decimals))

    return [
      {
        id: 'limit-orders-filled',
        type: 'success',
        title: isSingle
          ? 'Your limit order went through'
          : `${unseenFilledOrders.length} limit orders went through`,
        text:
          isSingle && order
            ? `You sold ${getAmount(order.executedSellAmount, order.sellToken.decimals)} ${
                order.sellToken.symbol
              } and got ${getAmount(order.executedBuyAmount, order.buyToken.decimals)} ${
                order.buyToken.symbol
              }.`
            : 'See what each one got in My orders.',
        actions: [
          { actionName: 'open-limit-orders-history', label: isSingle ? 'See order' : 'See orders' }
        ],
        dismissAction: { actionName: 'dismiss-limit-orders-filled-banner' },
        meta: { accountAddr }
      }
    ]
  }

  /**
   * Marks the selected account's filled orders as seen, which hides the dashboard banner about
   * them. Called when the user opens them, or dismisses the banner
   */
  markFilledOrdersAsSeen() {
    const accountAddr = this.#selectedAccount.account?.addr
    const unseenFilledOrders = this.#unseenFilledOrders
    if (!accountAddr || !unseenFilledOrders.length) return

    const seenUids = this.#seenFills.get(accountAddr.toLowerCase())
    if (!seenUids) return

    unseenFilledOrders.forEach((order) => seenUids.add(order.uid))
    this.emitUpdate()
    this.#saveSeenFills()
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

    this.#recheckFillIssuesIfNeeded()

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
   * Swap takes limit orders: with a balance and not hidden. Tokens without a USD price stay in
   * the list, as in Swap & Bridge, since a legit token may just not be priced
   */
  #updateFromTokenList() {
    const tokens = this.#selectedAccount.portfolio.tokens.filter(
      (token) =>
        this.supportedChainIds.includes(Number(token.chainId)) &&
        getIsTokenEligibleForSwapAndBridge(token, true) &&
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

  /** A typed amount in the smallest unit of a token. Null if empty, invalid or not positive */
  #parseAmount(amount: string, decimals: number): bigint | null {
    if (!amount) return null

    try {
      const parsed = parseUnits(getSanitizedAmount(amount, decimals), decimals)
      return parsed > 0n ? parsed : null
    } catch {
      // Not a number, e.g. a lone decimal point while the user types
      return null
    }
  }

  /**
   * The typed price in the smallest unit of the token the current view prices in, with
   * `PRICE_EXTRA_DECIMALS` more, see `#getAbsoluteTargetBuyAmount`. Null if the price is relative
   * or can't be read
   */
  #getTypedPriceUnits(): bigint | null {
    if (this.price.mode !== 'absolute') return null

    const token = this.priceView === 'cost' ? this.fromSelectedToken : this.toSelectedToken
    if (!token) return null

    return this.#parseAmount(this.price.amount, token.decimals + PRICE_EXTRA_DECIMALS)
  }

  /**
   * The amount of `fromSelectedToken` today's price is asked for, whatever amount the user enters,
   * so the market price doesn't change with it: worth `REFERENCE_QUOTE_USD_VALUE`, or the whole
   * balance if the token has no USD price, or one token. A quote for a small amount is less
   * reliable, and the network cost would weigh more on it
   */
  get #referenceSellAmount(): bigint | null {
    const token = this.fromSelectedToken
    if (!token) return null

    const usdPrice = token.priceIn.find(({ baseCurrency }) => baseCurrency === 'usd')?.price
    const amountWorthReference =
      usdPrice && usdPrice > 0
        ? this.#parseAmount(
            toPlainDecimalString(REFERENCE_QUOTE_USD_VALUE / usdPrice),
            token.decimals
          )
        : null
    if (amountWorthReference) return amountWorthReference
    if (this.#fromBalance > 0n) return this.#fromBalance

    return 10n ** BigInt(token.decimals)
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

  /**
   * How the price is shown and typed: what 1 sell token gets ("4.51 USDC / UNI") or what 1
   * receive token costs ("0.22 UNI / USDC"). The readable one, whose price is 1 or more, until the
   * user flips it, see `flipPriceView`
   */
  get priceView(): LimitOrderPriceView {
    return this.#priceView ?? 'get'
  }

  /** `marketQuote`, if it's for the current tokens, whatever the amount (see `marketQuote`) */
  get #currentMarketQuote(): LimitOrderMarketQuote | null {
    const quote = this.marketQuote
    if (!quote || !this.fromSelectedToken || !this.toSelectedToken) return null

    const isCurrent =
      quote.chainId === this.fromChainId &&
      quote.sellTokenAddress.toLowerCase() === this.fromSelectedToken.address.toLowerCase() &&
      quote.buyTokenAddress.toLowerCase() === this.toSelectedToken.address.toLowerCase()
    // An old price could let an order through that's worse than today's
    const isFresh = Date.now() - quote.fetchedAt < MARKET_QUOTE_MAX_AGE

    return isCurrent && isFresh ? quote : null
  }

  /**
   * What `sellAmount` gets at today's price, before the Ambire fee: the quoted amount scaled to
   * it, as today's price is asked for a set amount (see `#referenceSellAmount`)
   */
  static #getMarketBuyAmount(quote: LimitOrderMarketQuote, sellAmount: bigint): bigint {
    return (BigInt(quote.marketBuyAmount) * sellAmount) / BigInt(quote.sellAmount)
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
   * What the whole amount gets at the price the user set, after CoW Swap's network cost and
   * protocol fee and before the Ambire fee, in the smallest unit of the receive token. Today's
   * price (`marketBuyAmount`) is measured the same way, so the price the user sets is what the
   * order really gets, even for a small amount whose network cost is a large share of it. Null
   * until it can be calculated
   */
  get #triggerBuyAmount(): bigint | null {
    const view = this.priceView

    if (this.price.mode === 'absolute') {
      return this.#getAbsoluteTargetBuyAmount(this.price.amount, view)
    }

    const quote = this.#currentMarketQuote
    const sellAmount = this.#sellAmount
    if (!quote || !sellAmount) return null

    const marketBuyAmount = LimitOrdersController.#getMarketBuyAmount(quote, sellAmount)
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
   * user set gets after the Ambire fee. That price already counts CoW Swap's network cost and
   * protocol fee, so the order fills once the market, after those costs, reaches it. If the
   * network gets busier, the order fills a little later rather than at a worse price. Null until
   * it can be calculated
   */
  get #targetBuyAmount(): bigint | null {
    const triggerBuyAmount = this.#triggerBuyAmount
    if (triggerBuyAmount === null) return null

    // The Ambire fee as it is now, as the order carries the current one
    const feeBps = BigInt(Math.min(Math.max(this.#feeBps ?? 0, 0), 9999))
    const targetBuyAmount = (triggerBuyAmount * (10000n - feeBps)) / 10000n
    if (targetBuyAmount <= 0n) return null

    return targetBuyAmount
  }

  get targetBuyAmount(): string | null {
    return this.#targetBuyAmount?.toString() ?? null
  }

  /** Why the price can't be used. Null if it can, or if it's not known yet */
  get priceError(): LimitOrderPriceError | null {
    // Checked before there is an amount, so a price that can't be read shows as soon as it's typed
    const isTypedPriceInvalid =
      this.price.mode === 'absolute' &&
      !!this.fromSelectedToken &&
      !!this.toSelectedToken &&
      this.#getTypedPriceUnits() === null
    if (isTypedPriceInvalid) return 'invalid'
    const sellAmount = this.#sellAmount
    if (!sellAmount || !this.toSelectedToken) return null

    const triggerBuyAmount = this.#triggerBuyAmount
    if (this.price.mode === 'absolute' && triggerBuyAmount === null) return 'invalid'

    const quote = this.#currentMarketQuote
    if (!quote || triggerBuyAmount === null) return null

    // An order can't ask for a worse price than today's. It would fill right away at today's
    // price at best, so the user is better off with a swap
    const marketBuyAmount = LimitOrdersController.#getMarketBuyAmount(quote, sellAmount)
    if (triggerBuyAmount < marketBuyAmount) return 'worse-than-today'
    // The network cost and the fees would take everything the order gets
    if (sellAmount <= BigInt(quote.networkFee) || this.#targetBuyAmount === null) {
      return 'too-small'
    }

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
    // The form kept from a closed popup is on screen again
    this.hasPersistedPopupForm = false
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
    // A closed window can't say it stopped reviewing the order
    if (this.#reviewingSessionIds.delete(sessionId)) this.#followMarketPriceAfterReview()
    this.emitUpdate()
  }

  /**
   * Clears the form once no view shows a trade screen anymore. A filled form in a popup that
   * closed is kept instead, see `hasPersistedPopupForm`
   */
  #onViewLeftTradeRoutes(viewId: string, { isClosedPopup = false } = {}) {
    const wasOnTradeRoute = this.#viewIdsOnTradeRoutes.delete(viewId)
    if (!wasOnTradeRoute || this.#viewIdsOnTradeRoutes.size) return
    // A transaction being signed keeps the form it was built from
    if (this.isSignAndBroadcastInProgress) return

    this.sessionIds = []
    if (isClosedPopup && this.#isFormFilled) {
      // The transaction prepared from it wasn't signed, and today's price will be fetched again
      this.#destroySignAccountOp()
      this.hasPersistedPopupForm = true
      this.emitUpdate()
      return
    }

    this.resetForm()
    this.emitUpdate()
  }

  /** Whether the user entered something in the form, rather than only the tokens picked for them */
  get #isFormFilled() {
    return !!this.fromAmount || this.#hasUserPickedTokens
  }

  async updateForm(props: {
    fromAmount?: string
    fromSelectedToken?: TokenResult | null
    toSelectedToken?: SwapAndBridgeToToken | null
    expiryDays?: number
  }) {
    const { fromAmount, fromSelectedToken, toSelectedToken, expiryDays } = props
    const previousChainId = this.fromChainId
    const previousFromToken = this.fromSelectedToken
    const previousToToken = this.toSelectedToken
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
    if (toSelectedToken !== undefined) {
      this.toSelectedToken = toSelectedToken
      this.#hasUserPickedTokens = true
    }
    if (expiryDays !== undefined) this.#setExpiryDays(expiryDays)

    const haveTokensTradedPlaces = this.#tradePlacesIfSameToken({
      previousFromToken,
      previousToToken,
      pickedSide: this.#getPickedSide(fromSelectedToken, toSelectedToken)
    })
    // The amount was in the token that was sold before, e.g. 2 UNI must not become 2 USDC
    if (haveTokensTradedPlaces) this.fromAmount = ''

    // Limit orders stay on one network, so a sell token on another network clears what the
    // user receives
    const hasNetworkChanged = this.fromChainId !== previousChainId
    if (hasNetworkChanged) {
      this.toSelectedToken = null
      this.toTokenSearchTerm = ''
      this.toTokenSearchResults = []
      this.#deriveToTokens()
      this.#selectDefaultToToken()
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateToTokenList()
    }

    // Today's price is for the tokens, not the amount (see `#referenceSellAmount`), so only
    // picking a token asks for it again
    const hasPairChanged = fromSelectedToken !== undefined || toSelectedToken !== undefined
    if (hasPairChanged) {
      // A price typed for another pair means nothing for this one, nor does today's price or
      // the way the price reads. Tokens that only traded places are the same pair, so today's
      // price stays, read the other way (see `marketPrice`), and the price starts from it
      this.price = DEFAULT_LIMIT_ORDER_PRICE
      this.isPriceTyped = false
      this.#priceView = null
      if (haveTokensTradedPlaces) this.#setPriceFromMarketQuote()
      else this.marketQuote = null
      this.#scheduleMarketQuoteUpdate()
    }

    this.emitUpdate()
  }

  /**
   * Swaps the two tokens: the token received becomes the one sold, and the other way around. Only
   * possible when the account holds the token received, as the token sold is always one it holds.
   * The amount is cleared, as it was in the other token
   */
  async switchFromAndToTokens() {
    const toToken = this.toSelectedToken
    if (!this.fromSelectedToken || !toToken) return

    const nextFromToken = this.#getHeldPortfolioToken(toToken)
    if (!nextFromToken) {
      this.emitError({
        level: 'major',
        message: `You don't have any ${toToken.symbol} to sell.`,
        error: new SwapAndBridgeError('The token to sell is not in the portfolio.')
      })
      return
    }

    this.#hasUserPickedTokens = true
    // The tokens trade places, see `#tradePlacesIfSameToken`
    await this.updateForm({ fromSelectedToken: nextFromToken, fromAmount: '' })
  }

  /** Which token the user just picked: the one sold, the one received, or neither */
  #getPickedSide(
    fromSelectedToken: TokenResult | null | undefined,
    toSelectedToken: SwapAndBridgeToToken | null | undefined
  ): 'from' | 'to' | null {
    if (fromSelectedToken) return 'from'
    if (toSelectedToken) return 'to'

    return null
  }

  /**
   * Picking on one side the token that's on the other makes the two trade places, as a token
   * can't be traded for itself: with UNI sold for USDC, picking USDC to sell makes UNI the token
   * received. The token sold must be one the account holds, so picking UNI to receive while
   * selling it makes USDC the token sold only if the account holds USDC. Returns whether they
   * traded places
   */
  #tradePlacesIfSameToken({
    previousFromToken,
    previousToToken,
    pickedSide
  }: {
    previousFromToken: TokenResult | null
    previousToToken: SwapAndBridgeToToken | null
    pickedSide: 'from' | 'to' | null
  }): boolean {
    if (!pickedSide || !this.#isSameToken) return false

    if (pickedSide === 'from') {
      if (!previousFromToken) return false

      this.toSelectedToken = convertPortfolioTokenToSwapAndBridgeToToken(
        previousFromToken,
        Number(previousFromToken.chainId)
      )
      return true
    }

    const heldPreviousToToken = previousToToken
      ? this.#getHeldPortfolioToken(previousToToken)
      : null
    if (!heldPreviousToToken) return false

    this.fromSelectedToken = heldPreviousToToken
    return true
  }

  /** The account's own copy of a token, if it holds some of it */
  #getHeldPortfolioToken(token: { chainId: bigint | number; address: string }): TokenResult | null {
    return (
      this.#selectedAccount.portfolio.tokens.find(
        (t) =>
          t.chainId === BigInt(token.chainId) &&
          t.address.toLowerCase() === token.address.toLowerCase() &&
          !t.flags.onGasTank &&
          !t.flags.rewardsType &&
          getTokenAmount(t) > 0n
      ) ?? null
    )
  }

  /** Takes a whole number of days, from 1 to `LIMIT_ORDER_MAX_EXPIRY_DAYS` */
  #setExpiryDays(days: number) {
    const isValid = Number.isInteger(days) && days >= 1 && days <= LIMIT_ORDER_MAX_EXPIRY_DAYS
    if (!isValid) {
      this.emitError({
        level: 'silent',
        message: `Pick between 1 and ${LIMIT_ORDER_MAX_EXPIRY_DAYS} days.`,
        error: new SwapAndBridgeError(`Invalid limit order expiry: ${days} days.`)
      })
      return
    }

    this.expiryDays = days
  }

  /**
   * Called when a screen opens or closes the review of the order. While it's open, the price the
   * user reviews stays, rather than following today's price under the review and while the order
   * is placed. Back on the form it follows again, unless the user set it
   */
  setIsReviewing(sessionId: string, isReviewing: boolean) {
    if (isReviewing) {
      this.#reviewingSessionIds.add(sessionId)
      return
    }

    if (!this.#reviewingSessionIds.delete(sessionId)) return
    this.#followMarketPriceAfterReview()
  }

  /**
   * Back on the form, a price the user didn't set catches up with today's price right away,
   * rather than with the next one, so the form doesn't show it as worse than today's meanwhile
   */
  #followMarketPriceAfterReview() {
    if (this.#reviewingSessionIds.size || this.isPriceTyped) return

    this.#setPriceFromMarketQuote()
    this.emitUpdate()
  }

  /**
   * Sets the price the user typed. With `typedFor`, a price typed for other tokens is dropped,
   * and one typed in the other view is turned into the current one, as the field sends it after a
   * short pause, which may end after the user flipped the view or changed the tokens
   */
  setPrice(price: LimitOrderPrice, typedFor?: LimitOrderPriceTypedFor) {
    const priceInCurrentView = typedFor ? this.#getPriceInCurrentView(price, typedFor) : price
    if (!priceInCurrentView) return

    this.price =
      priceInCurrentView.mode === 'relative'
        ? {
            mode: 'relative',
            bps: Math.min(Math.max(Math.round(priceInCurrentView.bps), 0), MAX_COST_VIEW_BPS)
          }
        : { mode: 'absolute', amount: priceInCurrentView.amount }
    this.isPriceTyped = true
    this.lastPlacedOrderUid = null
    this.emitUpdate()
  }

  /**
   * A price typed for `typedFor`, read the way the form shows prices now. Null if it was typed
   * for other tokens, or can't be read the other way
   */
  #getPriceInCurrentView(
    price: LimitOrderPrice,
    typedFor: LimitOrderPriceTypedFor
  ): LimitOrderPrice | null {
    const isSamePair =
      !!this.fromSelectedToken &&
      !!this.toSelectedToken &&
      this.fromSelectedToken.address.toLowerCase() === typedFor.fromTokenAddress.toLowerCase() &&
      this.toSelectedToken.address.toLowerCase() === typedFor.toTokenAddress.toLowerCase()
    if (!isSamePair) return null
    // A relative price is better than today's by the same share whichever way it's read
    if (price.mode === 'relative' || typedFor.priceView === this.priceView) return price

    return this.#getFlippedAbsolutePrice(price.amount, this.priceView)
  }

  /**
   * A typed price read the other way (`1 / price`), rounded in the user's favour for `nextView`.
   * Null if it can't be read
   */
  #getFlippedAbsolutePrice(amount: string, nextView: LimitOrderPriceView): LimitOrderPrice | null {
    const flippedPrice = roundToSignificantDigits(
      1 / Number(amount),
      FLIPPED_PRICE_SIGNIFICANT_DIGITS,
      nextView === 'get' ? 'up' : 'down'
    )

    return flippedPrice ? { mode: 'absolute', amount: toPlainDecimalString(flippedPrice) } : null
  }

  /**
   * Shows the price the other way around, e.g. what 1 UNI gets in USDC instead of what 1 USDC
   * costs in UNI, and turns a typed price into the same price read that way. Rounded in the
   * user's favour, so a price at today's doesn't become worse than it
   */
  flipPriceView() {
    const nextView: LimitOrderPriceView = this.priceView === 'cost' ? 'get' : 'cost'

    if (this.price.mode === 'absolute') {
      this.price =
        this.#getFlippedAbsolutePrice(this.price.amount, nextView) ?? DEFAULT_LIMIT_ORDER_PRICE
    }

    this.#priceView = nextView
    this.lastPlacedOrderUid = null
    this.emitUpdate()
  }

  #scheduleMarketQuoteUpdate() {
    if (this.#marketQuoteDebounce) clearTimeout(this.#marketQuoteDebounce)
    // Drops the answer of a request in progress, as it's for the previous form
    this.#marketQuoteRequestId++

    if (!this.fromSelectedToken || !this.toSelectedToken || !this.#referenceSellAmount) {
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
      !!this.#referenceSellAmount &&
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
    const sellAmount = this.#referenceSellAmount
    const chainId = this.fromChainId
    if (!account || !fromToken || !toToken || !sellAmount || !chainId) return

    this.#marketQuoteRequestId++
    const requestId = this.#marketQuoteRequestId
    this.marketQuoteStatus = 'LOADING'
    this.emitUpdate()

    try {
      const { buyAmount, marketBuyAmount, networkFee, quoteId } =
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
        marketBuyAmount: marketBuyAmount.toString(),
        networkFee: networkFee.toString(),
        quoteId,
        fetchedAt: Date.now()
      }
      this.marketQuoteStatus = 'INITIAL'
      this.marketQuoteError = null
      this.#setPriceFromMarketQuote()
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
   * Turns a relative price into a typed one once today's price is known, so the price field shows
   * a number the user adjusts from there, read the readable way unless the user flipped it.
   * Rounded to a few digits, in the user's favour, so it doesn't become worse than today's price.
   * Until the user sets the price, it's set again from each new price of today, e.g. as it moves
   * or after the tokens trade places. Not while a screen reviews the order, see `setIsReviewing`
   */
  #setPriceFromMarketQuote() {
    const isPriceKept = this.isPriceTyped || !!this.#reviewingSessionIds.size
    if (isPriceKept && this.price.mode !== 'relative') return

    const marketPriceGetView = this.#getMarketPrice('get')
    if (!this.#priceView && marketPriceGetView) {
      this.#priceView = marketPriceGetView >= 1 ? 'get' : 'cost'
    }

    const bps = this.price.mode === 'relative' ? this.price.bps : DEFAULT_LIMIT_ORDER_PRICE_BPS
    const marketPrice = this.marketPrice
    const price = marketPrice ? this.#getPriceBetterThanMarket(marketPrice, bps) : null
    if (!price) return

    this.price = price
  }

  /** Today's price, read the way the form shows prices, see `priceView` and `#getMarketPrice` */
  get marketPrice(): number | null {
    return this.#getMarketPrice(this.priceView)
  }

  /**
   * Today's price read the given way: what 1 sell token gets, or what 1 receive token costs.
   * Read from `marketQuote` whichever way it was asked for, so it still shows right after the
   * tokens trade places, while the price for the new way loads. Null if there's no price for the
   * current tokens
   */
  #getMarketPrice(view: LimitOrderPriceView): number | null {
    const quote = this.marketQuote
    const fromToken = this.fromSelectedToken
    const toToken = this.toSelectedToken
    if (!quote || !fromToken || !toToken) return null

    const quoteSellAddress = quote.sellTokenAddress.toLowerCase()
    const quoteBuyAddress = quote.buyTokenAddress.toLowerCase()
    const fromAddress = fromToken.address.toLowerCase()
    const toAddress = toToken.address.toLowerCase()
    const isSameWay = quoteSellAddress === fromAddress && quoteBuyAddress === toAddress
    const isReversed = quoteSellAddress === toAddress && quoteBuyAddress === fromAddress
    if (!isSameWay && !isReversed) return null

    const soldToken = isSameWay ? fromToken : toToken
    const boughtToken = isSameWay ? toToken : fromToken
    const sold = Number(formatUnits(quote.sellAmount, soldToken.decimals))
    const bought = Number(formatUnits(quote.marketBuyAmount, boughtToken.decimals))
    if (!sold || !bought) return null

    // "get" is the price of the token the form sells, "cost" of the one it receives
    const isPriceForSoldToken = (view === 'get') === isSameWay

    return isPriceForSoldToken ? bought / sold : sold / bought
  }

  /**
   * A typed price `bps` better than `marketPrice`: more received for 1 sell token ("get"), or
   * less paid for 1 receive token ("cost"). Rounded to a few digits in the user's favour, so it
   * doesn't become worse than today's price
   */
  #getPriceBetterThanMarket(marketPrice: number, bps: number): LimitOrderPrice | null {
    const isHigherBetter = this.priceView === 'get'
    const clampedBps = Math.min(Math.max(bps, 0), MAX_COST_VIEW_BPS)
    const price = isHigherBetter
      ? marketPrice * (1 + clampedBps / 10000)
      : marketPrice * (1 - clampedBps / 10000)
    const roundedPrice = roundToSignificantDigits(
      price,
      PRICE_SIGNIFICANT_DIGITS,
      isHigherBetter ? 'up' : 'down'
    )
    if (!roundedPrice) return null

    return { mode: 'absolute', amount: toPlainDecimalString(roundedPrice) }
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

  /**
   * Picks the token to trade the token sold for when there's none, see
   * `getDefaultPricedInTokenAddresses`. Only from the tokens listed for the network, by address,
   * so a token that merely copies a name is never picked
   */
  #selectDefaultToToken() {
    const fromToken = this.fromSelectedToken
    if (this.toSelectedToken || !fromToken) return

    const defaultToken = getDefaultPricedInTokenAddresses(fromToken)
      .map((address) => this.#toTokens.find((t) => t.address.toLowerCase() === address))
      .find((token): token is SwapAndBridgeToToken => !!token)
    if (!defaultToken) return

    this.toSelectedToken = defaultToken
    this.price = DEFAULT_LIMIT_ORDER_PRICE
    this.#priceView = null
    this.marketQuote = null
    this.#scheduleMarketQuoteUpdate()
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
      this.#selectDefaultToToken()
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
      validTo: Math.floor(Date.now() / 1000) + this.expiryDays * SECONDS_IN_DAY,
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
      // Only a quote for the order's own amount describes it, see `#referenceSellAmount`
      quoteId: marketQuote?.sellAmount === sellAmount.toString() ? marketQuote.quoteId : null
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
      // The tokens stay for the next order, so it starts from today's price
      this.#scheduleMarketQuoteUpdate()
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
      mainCallIds: [orderUid],
      onBroadcasted: () => {
        const placeCall = calls.find((call) => call.id === orderUid)
        if (placeCall) {
          this.#unconfirmedOrderCalls.set(
            LimitOrdersController.#getSentCallKey(chainId, placeCall),
            {
              orderUid,
              purpose: 'place'
            }
          )
        }
        this.#rememberAccountWithOrders(account.addr)
        this.#startSeenFillsOnPlacing(account.addr)
        this.#placingOrderUids.add(orderUid)
        // So a fill is noticed even if the order is first listed after it filled
        this.#executedBuyAmounts.set(orderUid, 0n)
        this.lastPlacedOrderUid = orderUid
      }
    })
    if (!isInitialized) return
    // The form changed while the account details loaded, so the transaction is for an old one
    if (isStale()) {
      this.#destroySignAccountOp()
      this.emitUpdate()
      return
    }

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

    return getOpenLimitOrdersSellAmount(orders, sellToken, this.#placingOrderUids)
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
    mainCallIds,
    onBroadcasted
  }: {
    purpose: LimitOrderSignPurpose
    account: Account
    calls: Call[]
    network: Network
    provider: RPCProvider
    /**
     * The calls that do what the transaction is for, e.g. the order, or each order cancelled.
     * Without any of them, nothing was done
     */
    mainCallIds: string[]
    /** Called with the ids of the main calls that went out */
    onBroadcasted: (sentMainCallIds: Set<string>) => void
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
        // A basic account sends each call as a separate transaction, e.g. the token permission
        // and the order. If only the permission went out, the order isn't placed (or cancelled)
        // yet, and if the user stopped partway through cancelling, only some orders are
        const sentMainCallIds = new Set(
          props.submittedAccountOp.calls
            .map((call) => call.id)
            .filter((id): id is string => !!id && mainCallIds.includes(id))
        )
        if (sentMainCallIds.size) {
          onBroadcasted(sentMainCallIds)
        } else {
          this.#hasPartiallyBroadcast = true
          this.emitError({
            level: 'major',
            message: PARTIAL_BROADCAST_MESSAGES[purpose],
            error: new SwapAndBridgeError(`The limit order ${purpose} call was not broadcast.`)
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
    if (purpose === 'place' && !hasPartiallyBroadcast) {
      this.#resetFormFields()
      // The tokens stay for the next order, so it starts from today's price
      this.#scheduleMarketQuoteUpdate()
    }

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
    await this.withStatus('cancelOrder', async () => this.#cancelOrders([orderUid]))
  }

  /**
   * Cancels several orders with one confirmation. They must be on the same network, as one
   * transaction can't reach two networks
   */
  async cancelOrders(orderUids: string[]) {
    await this.withStatus('cancelOrder', async () => this.#cancelOrders(orderUids))
  }

  /** The order and how My orders lists it, or an error the user can act on */
  #getOrderToCancel(orderUid: string) {
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
    const call = this.#getCancelCall(order)
    if (!call) {
      throw new EmittableError({
        level: 'major',
        message: 'Unable to cancel this order. Please try again later.',
        error: new SwapAndBridgeError('Missing the ETH-flow data of the order to cancel.')
      })
    }

    return { order, listedOrder, call }
  }

  async #cancelOrders(orderUids: string[]) {
    const uniqueOrderUids = [...new Set(orderUids.map((uid) => uid.toLowerCase()))]
    const toCancel = uniqueOrderUids.map((uid) => this.#getOrderToCancel(uid))
    const [firstToCancel] = toCancel
    if (!firstToCancel) {
      throw new EmittableError({
        level: 'major',
        message: 'Select at least one order to cancel.',
        error: new SwapAndBridgeError('No orders to cancel.')
      })
    }
    const { chainId } = firstToCancel.listedOrder
    if (toCancel.some(({ listedOrder }) => listedOrder.chainId !== chainId)) {
      throw new EmittableError({
        level: 'major',
        message:
          'Orders on different networks can’t be cancelled together. Cancel the orders of one network at a time.',
        error: new SwapAndBridgeError('The orders to cancel are on different networks.')
      })
    }

    const { network, provider } = this.#getNetworkAndProvider(chainId)
    const calls = toCancel.map(({ call }) => call)

    const account = this.#selectedAccount.account
    if (!account) return

    if (account.safeCreation) {
      toCancel.forEach(({ order, call }) => {
        this.#callsSentToWindow.set(LimitOrdersController.#getSentCallKey(chainId, call), {
          orderUid: order.uid,
          purpose: 'cancel'
        })
      })
      await this.#signInWindow({ account, network, calls })
      // Shown as cancelling once the Safe's owners sign it and it's sent, see `onAccountOpBroadcast`
      return
    }

    const isInitialized = await this.#initSignAccountOp({
      purpose: 'cancel',
      account,
      calls,
      network,
      provider,
      mainCallIds: calls.map((call) => call.id).filter((id): id is string => !!id),
      onBroadcasted: (sentMainCallIds) => {
        toCancel.forEach(({ order, call }) => {
          // A basic account sends each cancel separately, and the user may stop partway
          if (!call.id || !sentMainCallIds.has(call.id)) return

          this.#unconfirmedOrderCalls.set(LimitOrdersController.#getSentCallKey(chainId, call), {
            orderUid: order.uid,
            purpose: 'cancel'
          })
          this.#cancellingOrderUids.add(order.uid)
        })
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
    this.#updateOrdersInterval.restart({ runImmediately: true, timeout: ORDERS_UPDATE_INTERVAL })
  }

  unloadOrders(sessionId: string) {
    this.ordersSessionIds = this.ordersSessionIds.filter((id) => id !== sessionId)
    // Slows down to the waiting orders' refresh, or stops
    this.#syncOrdersUpdates()
  }

  /**
   * How often the orders should be refreshed now: every 30 seconds while My orders is open, every
   * minute while the selected account has orders waiting and a wallet screen is open (so a fill
   * shows up on the dashboard). Null when nothing needs them, so CoW Swap isn't asked for nothing
   */
  #getOrdersUpdateTimeout(): number | null {
    if (this.ordersSessionIds.length) return ORDERS_UPDATE_INTERVAL
    if (!this.#ui.views.length) return null

    const accountAddr = this.#selectedAccount.account?.addr
    // The orders of the previous account, until the selected one's load
    if (!accountAddr || this.ordersAccountAddr !== accountAddr) return null

    const hasWaitingOrders = this.orders.some((order) =>
      WAITING_ORDER_STATUSES.includes(order.status)
    )

    return hasWaitingOrders ? WAITING_ORDERS_UPDATE_INTERVAL : null
  }

  /** Starts, speeds up, slows down or stops refreshing the orders, see `#getOrdersUpdateTimeout` */
  #syncOrdersUpdates() {
    const timeout = this.#getOrdersUpdateTimeout()
    if (timeout === null) {
      this.#updateOrdersInterval.stop()
      return
    }

    // Applies from the next refresh on
    if (this.#updateOrdersInterval.currentTimeout !== timeout) {
      this.#updateOrdersInterval.updateTimeout({ timeout })
    }
    // Not right away, as the orders were just loaded or the screen that opened loads them
    if (!this.#updateOrdersInterval.running) this.#updateOrdersInterval.start({ timeout })
  }

  async #continuouslyUpdateOrders() {
    if (this.#getOrdersUpdateTimeout() === null) {
      this.#updateOrdersInterval.stop()
      return
    }

    await this.updateOrders()
  }

  /**
   * Refreshes My orders. Not wrapped in `withStatus`, which would turn away placing or
   * cancelling an order while it runs, as it runs every 30 seconds while My orders is open and
   * every minute while orders wait (see `#getOrdersUpdateTimeout`)
   */
  async updateOrders(): Promise<void> {
    if (this.#ordersUpdate) {
      if (this.#ordersUpdateAccountAddr === (this.#selectedAccount.account?.addr ?? null)) {
        return this.#ordersUpdate
      }
      // The refresh in progress is of the account the user switched away from, and it stops
      // without loading the selected account's orders
      await this.#ordersUpdate
      return this.updateOrders()
    }

    this.isUpdatingOrders = true
    this.emitUpdate()
    this.#ordersUpdateAccountAddr = this.#selectedAccount.account?.addr ?? null
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

    this.#fillIssuesReadId++
    const fillIssues = await this.#getFillIssues(account.addr)
    if (this.#selectedAccount.account?.addr !== account.addr) return
    this.#fillIssues = fillIssues
    this.#fillIssuesReadAt = Date.now()
    this.#soldTokensBalancesSignature = this.#getSoldTokensBalancesSignature()

    this.#rebuildOrders()
    // Not when a network's orders didn't load, as their old fills would count as new later
    if (!failedCount) this.#markFillsSoFarAsSeen(account.addr)
    this.ordersUpdatedAt = Date.now()
    this.emitUpdate()
  }

  /**
   * Why each waiting order of the account can't fill. CoW Swap keeps listing an order as open
   * when the permission it relies on was removed or lowered (e.g. on another site), or when the
   * account no longer holds the token, so both are read for each token the orders sell. A token
   * whose reads fail is left out, so its orders aren't wrongly shown as unable to fill
   */
  async #getFillIssues(accountAddr: string): Promise<Map<string, LimitOrderFillIssue>> {
    const fillIssues = new Map<string, LimitOrderFillIssue>()
    const checks: Promise<void>[] = []

    this.#accountOrders.forEach((orders, chainId) => {
      const remainingByToken = new Map<string, { uid: string; remaining: bigint }[]>()
      orders.forEach((order) => {
        const remaining = LimitOrdersController.#getRemainingSellAmountNeedingPermission(order)
        if (!remaining) return

        const tokenAddress = order.sellToken.toLowerCase()
        remainingByToken.set(tokenAddress, [
          ...(remainingByToken.get(tokenAddress) || []),
          { uid: order.uid, remaining }
        ])
      })

      const provider = this.#providers.providers[chainId.toString()]
      if (!provider || !remainingByToken.size) return

      remainingByToken.forEach((tokenOrders, tokenAddress) => {
        checks.push(
          (async () => {
            const { allowance, balance } = await LimitOrdersController.#readPermissionAndBalance(
              provider,
              tokenAddress,
              accountAddr
            )
            // Each order is checked on its own, as each can fill with what's left for it
            tokenOrders.forEach(({ uid, remaining }) => {
              if (allowance < remaining) fillIssues.set(uid, 'permission')
              else if (balance < remaining) fillIssues.set(uid, 'balance')
            })
          })()
        )
      })
    })

    const results = await Promise.allSettled(checks)
    results.forEach((result) => {
      if (result.status === 'fulfilled') return
      this.emitError({
        level: 'silent',
        message: 'Failed to check whether the limit orders can fill',
        error: result.reason
      })
    })

    return fillIssues
  }

  /**
   * What a waiting order still sells from the account, which needs CoW Swap's permission and the
   * balance. Null for an order that needs neither
   */
  static #getRemainingSellAmountNeedingPermission(order: CowSwapAccountOrder): bigint | null {
    // The ETH-flow contract holds what an ETH-flow order sells, so it needs no permission
    if (order.status !== 'open' || order.ethflowData) return null
    const remaining = BigInt(order.sellAmount) - BigInt(order.executedSellAmount)

    return remaining > 0n ? remaining : null
  }

  /**
   * The account's balances of the tokens its known waiting orders sell, as the portfolio has them.
   * Empty if no known order needs a permission or a balance
   */
  #getSoldTokensBalancesSignature(): string {
    const tokenKeys = new Set<string>()
    this.#accountOrders.forEach((orders, chainId) => {
      orders.forEach((order) => {
        if (!LimitOrdersController.#getRemainingSellAmountNeedingPermission(order)) return
        tokenKeys.add(LimitOrdersController.#getTokenKey(chainId, order.sellToken))
      })
    })
    if (!tokenKeys.size) return ''

    const balances = new Map<string, bigint>()
    this.#selectedAccount.portfolio.tokens.forEach((token) => {
      const key = LimitOrdersController.#getTokenKey(Number(token.chainId), token.address)
      if (tokenKeys.has(key)) balances.set(key, token.amount)
    })

    return [...tokenKeys]
      .sort()
      .map((key) => `${key}:${balances.get(key)?.toString() ?? ''}`)
      .join(',')
  }

  /**
   * Reads the permission and the balance of the waiting orders again when the account's balances
   * update, so an order that can no longer fill (e.g. the tokens were sent elsewhere) is shown
   * without opening My orders. Only for orders already fetched for the account, so nothing is
   * read for an account without orders, or whose orders aren't known. Reads the network only,
   * never CoW Swap, and only when a sold token's balance changed or `FILL_ISSUES_MAX_AGE` passed
   */
  #recheckFillIssuesIfNeeded() {
    const accountAddr = this.#selectedAccount.account?.addr
    if (!accountAddr || this.ordersAccountAddr !== accountAddr || this.ordersUpdatedAt === null)
      return
    // A refresh of the orders reads them too
    if (this.#ordersUpdate || this.#fillIssuesRecheck) return

    const signature = this.#getSoldTokensBalancesSignature()
    if (!signature) return
    const hasBalanceChanged = signature !== this.#soldTokensBalancesSignature
    if (!hasBalanceChanged && Date.now() - this.#fillIssuesReadAt < FILL_ISSUES_MAX_AGE) return

    this.#soldTokensBalancesSignature = signature
    this.#fillIssuesRecheck = this.#recheckFillIssues(accountAddr)
      .catch((error) => {
        this.emitError({
          level: 'silent',
          message: 'Failed to check whether the limit orders can fill',
          error
        })
      })
      .finally(() => {
        this.#fillIssuesRecheck = null
      })
  }

  async #recheckFillIssues(accountAddr: string) {
    const readId = ++this.#fillIssuesReadId
    const fillIssues = await this.#getFillIssues(accountAddr)
    // A refresh of the orders or another account overtook it
    if (readId !== this.#fillIssuesReadId || this.ordersAccountAddr !== accountAddr) return

    this.#fillIssues = fillIssues
    this.#fillIssuesReadAt = Date.now()
    this.#rebuildOrders()
    this.emitUpdate()
  }

  /** CoW Swap's permission to use the token, and how much of it the account holds */
  static async #readPermissionAndBalance(
    provider: RPCProvider,
    tokenAddress: string,
    accountAddr: string
  ): Promise<{ allowance: bigint; balance: bigint }> {
    const [allowanceResult, balanceResult] = await Promise.all([
      provider.call({
        to: tokenAddress,
        data: erc20Interface.encodeFunctionData('allowance', [
          accountAddr,
          COWSWAP_VAULT_RELAYER_ADDRESS
        ])
      }),
      provider.call({
        to: tokenAddress,
        data: erc20Interface.encodeFunctionData('balanceOf', [accountAddr])
      })
    ])

    return {
      allowance: BigInt(erc20Interface.decodeFunctionResult('allowance', allowanceResult)[0]),
      balance: BigInt(erc20Interface.decodeFunctionResult('balanceOf', balanceResult)[0])
    }
  }

  /**
   * Gives CoW Swap back the permission to use the token an order sells, enough for all the open
   * orders selling it, so the orders the permission held back can fill again
   */
  async allowAgain(orderUid: string) {
    await this.withStatus('allowAgain', async () => this.#allowAgain(orderUid))
  }

  async #allowAgain(orderUid: string) {
    const listedOrder = this.orders.find((o) => o.uid.toLowerCase() === orderUid.toLowerCase())
    if (!listedOrder || listedOrder.fillIssue !== 'permission') {
      throw new EmittableError({
        level: 'major',
        message: 'This order no longer needs the permission. Refresh My orders and try again.',
        error: new SwapAndBridgeError('The order to allow again does not need a permission.')
      })
    }

    const account = this.#selectedAccount.account
    if (!account) return

    const { chainId, sellToken } = listedOrder
    const { network, provider } = this.#getNetworkAndProvider(chainId)
    const [neededAmount, { allowance }] = await Promise.all([
      this.#getOpenOrdersSellAmount({ chainId, owner: account.addr, sellToken: sellToken.address }),
      LimitOrdersController.#readPermissionAndBalance(provider, sellToken.address, account.addr)
    ])
    if (this.#selectedAccount.account?.addr !== account.addr) return
    if (neededAmount <= allowance) {
      // Already given back, e.g. in another window, so the next refresh shows the orders as fine
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateOrders()
      return
    }

    const approvalCallId = `${orderUid}-allow-again`
    const approve = (amount: bigint, id: string): Call => ({
      id,
      to: sellToken.address,
      value: 0n,
      data: erc20Interface.encodeFunctionData('approve', [COWSWAP_VAULT_RELAYER_ADDRESS, amount])
    })
    // Some tokens (e.g. USDT on Ethereum) refuse to change a permission that isn't zero
    const approvalCall = approve(neededAmount, approvalCallId)
    const calls: Call[] = [
      ...(allowance > 0n ? [approve(0n, `${orderUid}-allow-again-reset`)] : []),
      approvalCall
    ]

    if (account.safeCreation) {
      this.#callsSentToWindow.set(LimitOrdersController.#getSentCallKey(chainId, approvalCall), {
        orderUid,
        purpose: 'allow'
      })
      await this.#signInWindow({ account, network, calls })
      // Shown as being allowed again once the Safe's owners sign it and it's sent, see
      // `onAccountOpBroadcast`
      return
    }

    const isInitialized = await this.#initSignAccountOp({
      purpose: 'allow',
      account,
      calls,
      network,
      provider,
      mainCallIds: [approvalCallId],
      onBroadcasted: () => this.#markAllowing(chainId, approvalCall, sellToken.address)
    })
    if (!isInitialized) return

    this.hasProceeded = true
    this.emitUpdate()
  }

  #clearOrders() {
    this.#accountOrders.clear()
    this.#executedBuyAmounts.clear()
    this.#placingOrderUids.clear()
    this.#cancellingOrderUids.clear()
    this.#callsSentToWindow.clear()
    this.#allowingCalls.clear()
    this.#unconfirmedOrderCalls.clear()
    this.#fillIssues.clear()
    // Drops a check of the previous account's orders that is still running
    this.#fillIssuesReadId++
    this.#fillIssuesReadAt = 0
    this.#soldTokensBalancesSignature = ''
    this.orders = []
    this.ordersAccountAddr = this.#selectedAccount.account?.addr ?? null
    this.ordersError = null
    this.ordersUpdatedAt = null
    this.#syncOrdersUpdates()
  }

  /**
   * Marks the orders placed or cancelled by a broadcast transaction of the signing window, and the
   * orders whose permission it gives back. Called for every broadcast transaction, so it ignores
   * the ones that aren't about limit orders
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
        this.#unconfirmedOrderCalls.set(key, { orderUid: sentCall.orderUid, purpose: 'cancel' })
        this.#cancellingOrderUids.add(sentCall.orderUid)
        return
      }
      // The call gives the permission for the token it's sent to
      if (sentCall.purpose === 'allow') {
        if (call.to) {
          this.#allowingCalls.set(key, {
            tokenKey: LimitOrdersController.#getTokenKey(Number(chainId), call.to),
            sentAt: Date.now()
          })
        }
        return
      }

      this.#unconfirmedOrderCalls.set(key, { orderUid: sentCall.orderUid, purpose: 'place' })
      this.#rememberAccountWithOrders(accountAddr)
      this.#startSeenFillsOnPlacing(accountAddr)
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
   * Updates the orders once a transaction that places or cancels one, or gives back their
   * permission, is confirmed or won't go through (it failed, or the user cancelled or replaced
   * it while it was stuck), instead of waiting for the next scheduled refresh. Called with every
   * finalized transaction, after the RPC reached its block, so it ignores the ones that aren't ours
   */
  onAccountOpsFinalized(ops: SubmittedAccountOp[]) {
    const finalizedKeys = new Set<string>()
    const landedKeys = new Set<string>()
    ops.forEach(({ chainId, status, calls }) => {
      if (
        !status ||
        status === AccountOpStatus.Pending ||
        status === AccountOpStatus.BroadcastedButNotConfirmed
      )
        return

      calls.forEach((call) => {
        const key = LimitOrdersController.#getSentCallKey(chainId, call)
        if (!this.#allowingCalls.has(key) && !this.#unconfirmedOrderCalls.has(key)) return

        finalizedKeys.add(key)
        // Some of the calls of a batch sent as separate transactions may have gone through
        const hasLanded =
          status === AccountOpStatus.Success ||
          (status === AccountOpStatus.PartiallyComplete && call.status === AccountOpStatus.Success)
        if (hasLanded) landedKeys.add(key)
      })
    })
    if (!finalizedKeys.size) return

    let hasDroppedOrders = false
    finalizedKeys.forEach((key) => {
      const orderCall = this.#unconfirmedOrderCalls.get(key)
      if (!orderCall) return

      this.#unconfirmedOrderCalls.delete(key)
      // A transaction that went through leaves it to CoW Swap to list the order's new status. A
      // sped-up transaction has the same calls, so it went through if either of them did
      if (landedKeys.has(key)) return

      hasDroppedOrders = true
      if (orderCall.purpose === 'place') this.#placingOrderUids.delete(orderCall.orderUid)
      else this.#cancellingOrderUids.delete(orderCall.orderUid)
    })
    if (hasDroppedOrders) {
      this.#rebuildOrders()
      this.emitUpdate()
    }

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#refreshAfterFinalized([...finalizedKeys])
  }

  async #refreshAfterFinalized(finalizedKeys: string[]) {
    // A refresh in progress may have read the permission before the confirmation, so the orders
    // stay shown as being allowed again until a refresh that starts after it
    await this.#ordersUpdate
    finalizedKeys.forEach((key) => this.#allowingCalls.delete(key))
    // Whether it worked or failed, the refresh reads the permission and the statuses again
    await this.updateOrders()
  }

  /** Shows the orders of the token the call gives the permission for as being allowed again */
  #markAllowing(chainId: number, approvalCall: Call, tokenAddress: string) {
    this.#allowingCalls.set(LimitOrdersController.#getSentCallKey(chainId, approvalCall), {
      tokenKey: LimitOrdersController.#getTokenKey(chainId, tokenAddress),
      sentAt: Date.now()
    })
    this.#rebuildOrders()
    this.emitUpdate()
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
    const allowingTokenKeys = new Set<string>()
    this.#allowingCalls.forEach(({ tokenKey, sentAt }, key) => {
      if (Date.now() - sentAt > ALLOWING_AGAIN_MAX_AGE) this.#allowingCalls.delete(key)
      else allowingTokenKeys.add(tokenKey)
    })

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

        // Only an order that waits for its price can be held back by the permission or balance
        const fillIssue =
          status === 'open' || status === 'partiallyFilled'
            ? (this.#fillIssues.get(order.uid) ?? null)
            : null

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
          feeBps: getPartnerFeeBpsFromAppData(order.fullAppData),
          fillIssue,
          isAllowingAgain:
            fillIssue === 'permission' &&
            allowingTokenKeys.has(LimitOrdersController.#getTokenKey(chainId, order.sellToken))
        })
      })
    })

    this.orders = orders.sort((a, b) => b.createdAt - a.createdAt)
    // Orders started or stopped waiting, e.g. one was placed or the last one filled
    this.#syncOrdersUpdates()
  }

  /* -------------------------------- Reset -------------------------------- */

  #resetFormFields() {
    this.fromAmount = ''
    this.price = DEFAULT_LIMIT_ORDER_PRICE
    this.isPriceTyped = false
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
    this.hasPersistedPopupForm = false
    this.fromSelectedToken = null
    this.toSelectedToken = null
    this.#priceView = null
    this.#hasUserPickedTokens = false
    this.#reviewingSessionIds.clear()
    this.expiryDays = DEFAULT_LIMIT_ORDER_EXPIRY_DAYS
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
      priceView: this.priceView,
      marketPrice: this.marketPrice,
      feeExemptionReason: this.feeExemptionReason,
      triggerBuyAmount: this.triggerBuyAmount,
      targetBuyAmount: this.targetBuyAmount,
      priceError: this.priceError,
      formStatus: this.formStatus,
      signErrors: this.signErrors,
      toTokenShortList: this.toTokenShortList,
      signAccountOpController: this.signAccountOpController,
      isSignAndBroadcastInProgress: this.isSignAndBroadcastInProgress,
      banners: this.banners
    }
  }
}
