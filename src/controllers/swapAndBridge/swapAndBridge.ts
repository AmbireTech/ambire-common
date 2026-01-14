import { formatUnits, getAddress, isAddress, parseUnits, ZeroAddress } from 'ethers'

import EmittableError from '../../classes/EmittableError'
import { RecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout'
import SwapAndBridgeError from '../../classes/SwapAndBridgeError'
import {
  BRIDGE_STATUS_INTERVAL,
  UPDATE_SWAP_AND_BRIDGE_QUOTE_INTERVAL
} from '../../consts/intervals'
import { IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { Statuses } from '../../interfaces/eventEmitter'
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore'
import { INetworksController, Network } from '../../interfaces/network'
import { IPhishingController } from '../../interfaces/phishing'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
/* eslint-disable no-await-in-loop */
import { ISignAccountOpController, SignAccountOpError } from '../../interfaces/signAccountOp'
import { IStorageController } from '../../interfaces/storage'
import {
  CachedSupportedChains,
  CachedTokenListKey,
  FromToken,
  ISwapAndBridgeController,
  SwapAndBridgeActiveRoute,
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeRouteStatus,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeToToken,
  SwapProvider
} from '../../interfaces/swapAndBridge'
import { CallsUserRequest, UserRequest } from '../../interfaces/userRequest'
import { isSmartAccount } from '../../libs/account/account'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
import { getBridgeBanners } from '../../libs/banners/banners'
import { getAmbirePaymasterService } from '../../libs/erc7677/erc7677'
import { randomId } from '../../libs/humanizer/utils'
import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import {
  addCustomTokensIfNeeded,
  convertNullAddressToZeroAddressIfNeeded,
  convertPortfolioTokenToSwapAndBridgeToToken,
  getActiveRoutesForAccount,
  getActiveRoutesLowestServiceTime,
  getBannedToTokenList,
  getIsTokenEligibleForSwapAndBridge,
  getSwapAndBridgeCalls,
  isTxnBridge,
  mapBannedToValidAddr,
  sortPortfolioTokenList,
  sortTokenListResponse
} from '../../libs/swapAndBridge/swapAndBridge'
import { getHumanReadableSwapAndBridgeError } from '../../libs/swapAndBridge/swapAndBridgeErrorHumanizer'
import { getSanitizedAmount } from '../../libs/transfer/amount'
import { NULL_ADDRESS } from '../../services/socket/constants'
import { validateSendTransferAmount } from '../../services/validations/validate'
import {
  convertTokenPriceToBigInt,
  getSafeAmountFromFieldValue
} from '../../utils/numbers/formatters'
import { generateUuid } from '../../utils/uuid'
import wait from '../../utils/wait'
import { EstimationStatus } from '../estimation/types'
import EventEmitter from '../eventEmitter/eventEmitter'
import {
  OnBroadcastFailed,
  OnBroadcastSuccess,
  SignAccountOpController
} from '../signAccountOp/signAccountOp'

type SwapAndBridgeErrorType = {
  id: 'to-token-list-fetch-failed' | 'no-routes' | 'all-routes-failed'
  title: string
  text?: string
  level: 'error' | 'warning'
}

const HARD_CODED_CURRENCY = 'usd'

const CONVERSION_PRECISION = 16
const CONVERSION_PRECISION_POW = BigInt(10 ** CONVERSION_PRECISION)

const NETWORK_MISMATCH_MESSAGE =
  'Swap & Bridge network configuration mismatch. Please try again or contact Ambire support.'

// For performance reasons, limit the max number of tokens in the to token list
const TO_TOKEN_LIST_LIMIT = 100

export enum SwapAndBridgeFormStatus {
  Empty = 'empty',
  Invalid = 'invalid',
  FetchingRoutes = 'fetching-routes',
  NoRoutesFound = 'no-routes-found',
  InvalidRouteSelected = 'invalid-route-selected',
  ReadyToEstimate = 'ready-to-estimate',
  ReadyToSubmit = 'ready-to-submit',
  Proceeded = 'proceeded'
}

const STATUS_WRAPPED_METHODS = {
  addToTokenByAddress: 'INITIAL'
} as const

const SUPPORTED_CHAINS_CACHE_THRESHOLD = 1000 * 60 * 60 * 24 // 1 day
const TO_TOKEN_LIST_CACHE_THRESHOLD = 1000 * 60 * 60 * 4 // 4 hours

/**
 * The Swap and Bridge controller is responsible for managing the state and
 * logic related to swapping and bridging tokens across different networks.
 * Key responsibilities:
 *  - Initially setting up the swap and bridge form with the necessary data.
 *  - Managing form state for token swap and bridge operations (including user preferences).
 *  - Fetching and updating token lists (from and to).
 *  - Fetching and updating quotes for token swaps and bridges.
 *  - Manages token active routes
 */
export class SwapAndBridgeController extends EventEmitter implements ISwapAndBridgeController {
  #callRelayer: Function

  #selectedAccount: ISelectedAccountController

  #networks: INetworksController

  #activity: IActivityController

  #storage: IStorageController

  #serviceProviderAPI: SwapProvider

  #activeRoutes: SwapAndBridgeActiveRoute[] = []

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  updateQuoteStatus: 'INITIAL' | 'LOADING' = 'INITIAL'

  #updateQuoteId?: string

  switchTokensStatus: 'INITIAL' | 'LOADING' = 'INITIAL'

  sessionIds: string[] = []

  fromChainId: number | null = 1

  fromSelectedToken: FromToken | null = null

  fromAmount: string = ''

  fromAmountInFiat: string = ''

  /**
   * A counter used to trigger UI updates when the amount is changed programmatically
   * by the controller.
   */
  fromAmountUpdateCounter: number = 0

  fromAmountFieldMode: 'fiat' | 'token' = 'token'

  toChainId: number | null = 1

  toSelectedToken: SwapAndBridgeToToken | null = null

  toTokenSearchTerm: string = ''

  toTokenSearchResults: SwapAndBridgeToToken[] = []

  quote: SwapAndBridgeQuote | null = null

  quoteRoutesStatuses: { [key: string]: { status: string } } = {}

  portfolioTokenList: FromToken[] = []

  isTokenListLoading: boolean = false

  errors: SwapAndBridgeErrorType[] = []

  #toTokenList: {
    [key in CachedTokenListKey]?: {
      status: 'INITIAL' | 'LOADING'
      // Timestamp (in ms) of the last successful `apiTokens` update.
      lastUpdate: number
      // Raw tokens fetched from the API, refreshed periodically based on SUPPORTED_CHAINS_CACHE_THRESHOLD.
      apiTokens: SwapAndBridgeToToken[]
      // Final, processed list of tokens shown to the user.
      // Includes: `apiTokens` + portfolio tokens + post-filtering and sorting logic.
      // Use this array in all UI and presentation layers.
      tokens: SwapAndBridgeToToken[]
    }
  } = {}

  /**
   * Similar to the `#toTokenList[key].apiTokens`, this helps in avoiding repeated API
   * calls to fetch the supported chains from our service provider.
   */
  #cachedSupportedChains: CachedSupportedChains = { lastFetched: 0, data: [] }

  routePriority: 'output' | 'time' = 'output'

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise?: Promise<void>

  #shouldDebounceFlags: { [key: string]: boolean } = {}

  #accounts: IAccountsController

  #keystore: IKeystoreController

  #portfolio: IPortfolioController

  #externalSignerControllers: ExternalSignerControllers

  #providers: IProvidersController

  #phishing: IPhishingController

  /**
   * A possibly outdated instance of the SignAccountOpController. Please always
   * read the public getter `signAccountOpController` to get the up-to-date
   * instance. If updating a route consists of:
   * QUOTE FETCH -> ROUTE START -> ROUTE ESTIMATION
   *
   * This instance may be outdated during QUOTE FETCH -> ROUTE START
   * The reason is that the controller is not immediately destroyed after the
   * form changes, but instead is being updated after the route is started.
   */
  #signAccountOpController: ISignAccountOpController | null = null

  #portfolioUpdate?: (chainsToUpdate: Network['chainId'][]) => void

  #isCurrentSignAccountOpThrowingAnEstimationError: Function | undefined

  #getUserRequests: () => UserRequest[]

  #getVisibleUserRequests: () => UserRequest[]

  hasProceeded: boolean = false

  #relayerUrl: string

  #updateQuoteInterval: RecurringTimeout

  get updateQuoteInterval() {
    return this.#updateQuoteInterval
  }

  #updateActiveRoutesInterval: RecurringTimeout

  get updateActiveRoutesInterval() {
    return this.#updateActiveRoutesInterval
  }

  #continuouslyUpdateActiveRoutesPromise: Promise<void> | undefined

  #continuouslyUpdateActiveRoutesSessionId: string | undefined

  #onBroadcastSuccess: OnBroadcastSuccess

  #onBroadcastFailed: OnBroadcastFailed

  constructor({
    callRelayer,
    accounts,
    keystore,
    portfolio,
    externalSignerControllers,
    providers,
    selectedAccount,
    networks,
    activity,
    storage,
    phishing,
    portfolioUpdate,
    relayerUrl,
    isCurrentSignAccountOpThrowingAnEstimationError,
    getUserRequests,
    getVisibleUserRequests,
    swapProvider,
    onBroadcastSuccess,
    onBroadcastFailed
  }: {
    callRelayer: Function
    accounts: IAccountsController
    keystore: IKeystoreController
    portfolio: IPortfolioController
    externalSignerControllers: ExternalSignerControllers
    providers: IProvidersController
    selectedAccount: ISelectedAccountController
    networks: INetworksController
    activity: IActivityController
    storage: IStorageController
    phishing: IPhishingController
    relayerUrl: string
    portfolioUpdate?: (chainsToUpdate: Network['chainId'][]) => void
    isCurrentSignAccountOpThrowingAnEstimationError?: Function
    getUserRequests: () => UserRequest[]
    getVisibleUserRequests: () => UserRequest[]
    swapProvider: SwapProvider
    onBroadcastSuccess: OnBroadcastSuccess
    onBroadcastFailed: OnBroadcastFailed
  }) {
    super()
    this.#callRelayer = callRelayer
    this.#accounts = accounts
    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#externalSignerControllers = externalSignerControllers
    this.#providers = providers
    this.#portfolioUpdate = portfolioUpdate
    this.#isCurrentSignAccountOpThrowingAnEstimationError =
      isCurrentSignAccountOpThrowingAnEstimationError
    this.#selectedAccount = selectedAccount
    this.#networks = networks
    this.#activity = activity
    this.#serviceProviderAPI = swapProvider
    this.#storage = storage
    this.#phishing = phishing
    this.#relayerUrl = relayerUrl
    this.#getUserRequests = getUserRequests
    this.#getVisibleUserRequests = getVisibleUserRequests
    this.#onBroadcastSuccess = onBroadcastSuccess
    this.#onBroadcastFailed = onBroadcastFailed

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#initialLoadPromise = this.#load().finally(() => {
      this.#initialLoadPromise = undefined
    })

    this.#updateQuoteInterval = new RecurringTimeout(
      async () => this.continuouslyUpdateQuote(),
      UPDATE_SWAP_AND_BRIDGE_QUOTE_INTERVAL,
      this.emitError.bind(this)
    )

    this.#updateActiveRoutesInterval = new RecurringTimeout(
      async () => this.continuouslyUpdateActiveRoutes(),
      BRIDGE_STATUS_INTERVAL,
      this.emitError.bind(this)
    )
  }

  #emitUpdateIfNeeded(forceUpdate: boolean = false) {
    const shouldSkipUpdate =
      // No need to emit emit updates if there are no active sessions
      !this.sessionIds.length &&
      // but ALSO there are no active routes (otherwise, banners need the updates)
      !this.activeRoutes.length &&
      // Force update is needed when the form is reset
      // as the sessions are cleared
      !forceUpdate

    if (shouldSkipUpdate) return

    super.emitUpdate()
  }

  #setFromAmountAndNotifyUI(amount: string) {
    this.fromAmount = amount
    this.fromAmountUpdateCounter += 1
  }

  #setFromAmountInFiatAndNotifyUI(amountInFiat: string) {
    this.fromAmountInFiat = amountInFiat
    this.fromAmountUpdateCounter += 1
  }

  #setFromAmountAmount(fromAmount: string, isProgrammaticUpdate = false) {
    const fromAmountFormatted = fromAmount.indexOf('.') === 0 ? `0${fromAmount}` : fromAmount
    this.fromAmount = fromAmount

    if (isProgrammaticUpdate) {
      // There is no problem in updating this first as there are no
      // emit updates in this method
      this.fromAmountUpdateCounter += 1
    }

    if (fromAmount === '') {
      this.fromAmountInFiat = ''
      return
    }
    const tokenPrice = this.fromSelectedToken?.priceIn.find(
      (p) => p.baseCurrency === HARD_CODED_CURRENCY
    )?.price

    if (!tokenPrice) {
      this.fromAmountInFiat = ''
      return
    }

    if (
      this.fromAmountFieldMode === 'fiat' &&
      typeof this.fromSelectedToken?.decimals === 'number'
    ) {
      this.fromAmountInFiat = fromAmount

      // Get the number of decimals
      const amountInFiatDecimals = 10
      const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

      // Convert the numbers to big int
      const amountInFiatBigInt = parseUnits(
        getSanitizedAmount(fromAmountFormatted, amountInFiatDecimals),
        amountInFiatDecimals
      )

      this.fromAmount = formatUnits(
        (amountInFiatBigInt * CONVERSION_PRECISION_POW) / tokenPriceBigInt,
        // Shift the decimal point by the number of decimals in the token price
        amountInFiatDecimals + CONVERSION_PRECISION - tokenPriceDecimals
      )

      return
    }
    if (this.fromAmountFieldMode === 'token') {
      this.fromAmount = fromAmount

      if (!this.fromSelectedToken) return

      // Convert the field value to big int
      const formattedAmount = parseUnits(
        getSafeAmountFromFieldValue(fromAmount, this.fromSelectedToken.decimals),
        this.fromSelectedToken.decimals
      )

      if (!formattedAmount) return

      const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

      this.fromAmountInFiat = formatUnits(
        formattedAmount * tokenPriceBigInt,
        // Shift the decimal point by the number of decimals in the token price
        this.fromSelectedToken.decimals + tokenPriceDecimals
      )
    }
  }

  async #load() {
    await this.#networks.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise

    // FIXME: Temporarily omit getting prev activeRoutes from storage, because of
    // old records with different (unexpected) structure causing crashes.
    // this.activeRoutes = await this.#storage.get('swapAndBridgeActiveRoutes', [])

    // FIXME: Figure out a mechanism to clean up these routes in storage,
    // otherwise this is a potential storage leak (although we have unlimited storage permission).
    // also, just in case protection: filter out ready routes as we don't have
    // retry mechanism or follow up transaction handling anymore. Which means
    // ready routes in the storage are just leftover routes.
    // Same is true for completed, failed and refunded routes - they are just
    // leftover routes in storage
    // const filterOutStatuses = ['ready', 'completed', 'failed', 'refunded']
    // this.activeRoutes = this.activeRoutes.filter((r) => !filterOutStatuses.includes(r.routeStatus))

    this.#selectedAccount.onUpdate(() => {
      this.#debounceFunctionCallsOnSameTick('updateFormOnSelectedAccountUpdate', async () => {
        if (this.#selectedAccount.portfolio.isReadyToVisualize && this.sessionIds.length) {
          this.isTokenListLoading = false
          await this.updatePortfolioTokenList(
            structuredClone(this.#selectedAccount.portfolio.tokens)
          )
          // To token list includes selected account portfolio tokens, it should get an update too
          await this.updateToTokenList(false)
        }
      })
    })
    // Fetch the supported networks in the beginning so we can disable the
    // swap and bridge button of unsupported tokens on the dashboard, even if
    // the user hasn't yet opened the swap and bridge screen
    // (forceEmit true is crucial here)
    this.#fetchSupportedChainsIfNeeded(true)
  }

  // The token in portfolio is the source of truth for the amount, it updates
  // on every balance (pending or anything) change.
  #getFromSelectedTokenInPortfolio = () =>
    this.portfolioTokenList.find(
      (t) =>
        t.address === this.fromSelectedToken?.address &&
        t.chainId === this.fromSelectedToken?.chainId &&
        // We skip the positive balance requirement here,
        // because we only need to retrieve the token from the portfolio list
        // and apply the basic eligibility checks (not a reward or Gas Tank token).
        // Enforcing a positive balance would prevent tokens with zero balance
        // from being found, which would break the MIN amount validation in `validateFromAmount()`.
        getIsTokenEligibleForSwapAndBridge(t, false)
    )

  get maxFromAmount(): string {
    const tokenRef = this.#getFromSelectedTokenInPortfolio() || this.fromSelectedToken
    if (!tokenRef || getTokenAmount(tokenRef) === 0n || typeof tokenRef.decimals !== 'number')
      return '0'

    return formatUnits(getTokenAmount(tokenRef), tokenRef.decimals)
  }

  get maxFromAmountInFiat(): string {
    const tokenRef = this.#getFromSelectedTokenInPortfolio() || this.fromSelectedToken
    if (!tokenRef || getTokenAmount(tokenRef) === 0n) return '0'

    const tokenPrice = tokenRef?.priceIn.find((p) => p.baseCurrency === HARD_CODED_CURRENCY)?.price
    if (!tokenPrice || !Number(this.maxFromAmount)) return '0'

    const maxAmount = getTokenAmount(tokenRef)
    const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

    // Multiply the max amount by the token price. The calculation is done in big int to avoid precision loss
    return formatUnits(
      BigInt(maxAmount) * tokenPriceBigInt,
      // Shift the decimal point by the number of decimals in the token price
      tokenRef.decimals + tokenPriceDecimals
    )
  }

  get isFormEmpty() {
    return (
      !this.fromChainId ||
      !this.toChainId ||
      !this.fromAmount ||
      !this.fromSelectedToken ||
      !this.toSelectedToken
    )
  }

  /**
   * Returns an instance of the SignAccountOpController that is ALWAYS up-to-date with the current
   * quote and the current form state.
   */
  get signAccountOpController() {
    const controllerFromQuoteId = this.#signAccountOpController?.accountOp.meta?.fromQuoteId

    const isSignAccountOpCtrlStale =
      controllerFromQuoteId && controllerFromQuoteId !== this.#updateQuoteId

    if (isSignAccountOpCtrlStale) return null

    return this.#signAccountOpController
  }

  get formStatus() {
    if (this.hasProceeded) return SwapAndBridgeFormStatus.Proceeded

    if (this.isFormEmpty) return SwapAndBridgeFormStatus.Empty
    if (this.validateFromAmount.message || this.swapSignErrors.length)
      return SwapAndBridgeFormStatus.Invalid
    if (this.updateQuoteStatus === 'LOADING') return SwapAndBridgeFormStatus.FetchingRoutes
    if (!this.quote || !this.quote.routes.length) return SwapAndBridgeFormStatus.NoRoutesFound

    if (this.quote?.selectedRoute?.disabled) return SwapAndBridgeFormStatus.InvalidRouteSelected

    if (
      !this.signAccountOpController ||
      this.signAccountOpController.estimation.status !== EstimationStatus.Success
    )
      return SwapAndBridgeFormStatus.ReadyToEstimate

    return SwapAndBridgeFormStatus.ReadyToSubmit
  }

  get validateFromAmount() {
    const fromSelectedTokenWithUpToDateAmount = this.#getFromSelectedTokenInPortfolio()

    if (!fromSelectedTokenWithUpToDateAmount) return { success: false, message: '' }

    if (
      !this.isFormEmpty &&
      !this.quote &&
      Object.values(this.quoteRoutesStatuses).some((val) => val.status === 'MIN_AMOUNT_NOT_MET')
    ) {
      return {
        success: true,
        message: '🔔 A route was found for this pair but the minimum token amount was not met.'
      }
    }

    return validateSendTransferAmount(this.fromAmount, fromSelectedTokenWithUpToDateAmount)
  }

  get activeRoutesInProgress() {
    return this.activeRoutes.filter((r) => r.routeStatus === 'in-progress' && r.userTxHash)
  }

  get activeRoutes() {
    return this.#activeRoutes
  }

  set activeRoutes(value: SwapAndBridgeActiveRoute[]) {
    this.#activeRoutes = value
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('swapAndBridgeActiveRoutes', value)

    if (!this.activeRoutesInProgress.length) {
      this.#updateActiveRoutesInterval.stop()
      return
    }

    const minServiceTime = getActiveRoutesLowestServiceTime(this.activeRoutesInProgress)

    if (!this.#updateActiveRoutesInterval.running) {
      this.#updateActiveRoutesInterval.start({ timeout: minServiceTime })
      return
    }

    // If the interval is running, check if minServiceTime * 2 is still less than currentTimeout.
    // If it is, restart it with the new minServiceTime, as the difference makes it worth it.
    if (minServiceTime * 2 < this.#updateActiveRoutesInterval.currentTimeout) {
      this.#updateActiveRoutesInterval.restart({ timeout: minServiceTime })
    }
  }

  get shouldEnableRoutesSelection() {
    return (
      !!this.quote &&
      !!this.quote.routes &&
      this.quote.routes.length > 0 &&
      this.updateQuoteStatus !== 'LOADING'
    )
  }

  async initForm(
    sessionId: string,
    params?: {
      preselectedFromToken?: Pick<TokenResult, 'address' | 'chainId'>
      preselectedToToken?: Pick<TokenResult, 'address' | 'chainId'>
      fromAmount?: string
      activeRouteIdToDelete?: SwapAndBridgeSendTxRequest['activeRouteId']
    }
  ) {
    const { preselectedFromToken, preselectedToToken, fromAmount, activeRouteIdToDelete } =
      params || {}
    await this.#initialLoadPromise

    // if the provider is socket, convert the null addresses
    if (preselectedFromToken) {
      this.#emitSilentErrorIfNullAddress(preselectedFromToken.address)
      preselectedFromToken.address = mapBannedToValidAddr(
        Number(preselectedFromToken.chainId),
        convertNullAddressToZeroAddressIfNeeded(preselectedFromToken.address)
      )
    }
    if (preselectedToToken) {
      this.#emitSilentErrorIfNullAddress(preselectedToToken.address)
      preselectedToToken.address = mapBannedToValidAddr(
        Number(preselectedToToken.chainId),
        convertNullAddressToZeroAddressIfNeeded(preselectedToToken.address)
      )
    }

    if (this.sessionIds.includes(sessionId)) return

    // reset only if there are no other instances opened/active
    if (!this.sessionIds.length) {
      this.reset() // clear prev session form state
      // for each new session remove the completed activeRoutes from the previous session
      this.activeRoutes = this.activeRoutes.filter((r) => r.routeStatus !== 'completed')
      // remove activeRoutes errors from the previous session
      this.activeRoutes.forEach((r) => {
        if (r.routeStatus !== 'failed') {
          // eslint-disable-next-line no-param-reassign
          delete r.error
        }
      })
      if (this.activeRoutes.length) {
        // Otherwise there may be an emitUpdate with [] tokens
        this.isTokenListLoading = true

        // update the activeRoute.route prop for the new session
        this.activeRoutes.forEach((r) => {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.updateActiveRoute(r.activeRouteId, undefined, true)
        })
      }
    }

    this.sessionIds.push(sessionId)
    // do not await the health status check to prevent UI freeze while fetching
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#serviceProviderAPI.updateHealth()
    await this.updatePortfolioTokenList(structuredClone(this.#selectedAccount.portfolio.tokens), {
      preselectedToken: preselectedFromToken,
      preselectedToToken,
      fromAmount
    })
    this.isTokenListLoading = false
    // Do not await on purpose as it's not critical for the controller state to be ready
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#fetchSupportedChainsIfNeeded()

    if (activeRouteIdToDelete) {
      this.removeActiveRoute(activeRouteIdToDelete, false)
    }

    this.#emitUpdateIfNeeded()
  }

  // Temporary helper to monitor if NULL token addresses are still passed
  // to initForm or updateForm in the Swap & Bridge controller.
  // In theory, this should no longer happen after the fixes in socket/api.ts,
  // but we'll keep tracking it in Sentry for about a month to confirm.
  // If no errors are reported, we'll remove both this function and the
  // convertNullAddressToZeroAddressIfNeeded logic from initForm/updateForm.
  #emitSilentErrorIfNullAddress(address: string) {
    if (address.toLocaleLowerCase() === NULL_ADDRESS) {
      const message =
        'NULL token address detected while updating or initializing the Swap & Bridge controller.'

      this.emitError({
        level: 'silent',
        message,
        error: new Error(message)
      })
    }
  }

  get isHealthy() {
    return this.#serviceProviderAPI.isHealthy
  }

  #fetchSupportedChainsIfNeeded = async (forceUpdate?: boolean) => {
    const shouldNotReFetchSupportedChains =
      this.#cachedSupportedChains.data.length &&
      Date.now() - this.#cachedSupportedChains.lastFetched < SUPPORTED_CHAINS_CACHE_THRESHOLD
    if (shouldNotReFetchSupportedChains) return

    try {
      const supportedChains = await this.#serviceProviderAPI.getSupportedChains()

      this.#cachedSupportedChains = { lastFetched: Date.now(), data: supportedChains }
      this.#emitUpdateIfNeeded(forceUpdate)
    } catch (error: any) {
      // Fail silently, as this is not a critical feature, Swap & Bridge is still usable
      this.emitError({ error, level: 'silent', message: error?.message })
    }
  }

  get supportedChainIds(): Network['chainId'][] {
    // if the account is smart, do not allow the user to bridge to
    // a chain that doesn't support our smart accounts as those funds
    // would be stuck
    if (isSmartAccount(this.#selectedAccount.account)) {
      return this.#cachedSupportedChains.data
        .filter((c) => {
          const network = this.#networks.networks.find((net) => net.chainId === BigInt(c.chainId))
          if (!network) return false
          return network.areContractsDeployed && (network.hasRelayer || network.erc4337.enabled)
        })
        .map((c) => BigInt(c.chainId))
    }

    return this.#cachedSupportedChains.data.map((c) => BigInt(c.chainId))
  }

  get #toTokenListKey(): CachedTokenListKey | null {
    if (this.fromChainId === null || this.toChainId === null) return null

    return `from-${this.fromChainId}-to-${this.toChainId}`
  }

  // Get the toTokenListKey from parameters instead of `this`,
  // because during async execution, the class state may already point
  // to a different chain pair.
  static getToTokenListKey(
    fromChainId: number | null,
    toChainId: number | null
  ): CachedTokenListKey | null {
    if (fromChainId === null || toChainId === null) return null

    return `from-${fromChainId}-to-${toChainId}`
  }

  unloadScreen(sessionId: string, forceUnload?: boolean) {
    const isFormDirty = !!this.fromAmount || !!this.toSelectedToken
    const shouldPersistState = isFormDirty && sessionId === 'popup' && !forceUnload

    if (shouldPersistState) return

    this.sessionIds = this.sessionIds.filter((id) => id !== sessionId)
    if (!this.sessionIds.length) {
      this.reset(true)
      // Reset health to prevent the error state from briefly flashing
      // before the next health check resolves when the Swap & Bridge
      // screen is opened after a some time
      this.#serviceProviderAPI.resetHealth()
    }
    this.hasProceeded = false
  }

  addOrUpdateError(error: SwapAndBridgeErrorType) {
    const errorIndex = this.errors.findIndex((e) => e.id === error.id)
    if (errorIndex === -1) {
      this.errors.push(error)
    } else {
      this.errors[errorIndex] = error
    }
    this.#emitUpdateIfNeeded()
  }

  removeError(id: SwapAndBridgeErrorType['id'], shouldEmit?: boolean) {
    this.errors = this.errors.filter((e) => e.id !== id)
    if (shouldEmit) this.#emitUpdateIfNeeded()
  }

  async updateForm(
    props: {
      fromAmount?: string
      fromAmountInFiat?: string
      shouldSetMaxAmount?: boolean
      fromAmountFieldMode?: 'fiat' | 'token'
      fromSelectedToken?: TokenResult | null
      toChainId?: bigint | number
      toSelectedTokenAddr?: SwapAndBridgeToToken['address'] | null
      routePriority?: 'output' | 'time'
    },
    updateProps?: {
      emitUpdate?: boolean
      updateQuote?: boolean
      shouldIncrementFromAmountUpdateCounter?: boolean
    }
  ) {
    const {
      fromAmount,
      fromAmountInFiat,
      fromAmountFieldMode,
      toChainId,
      shouldSetMaxAmount,
      routePriority
    } = props

    const fromSelectedToken = props.fromSelectedToken
    if (fromSelectedToken) {
      this.#emitSilentErrorIfNullAddress(fromSelectedToken.address)
      // if the provider is socket, convert the null addresses
      fromSelectedToken.address = convertNullAddressToZeroAddressIfNeeded(fromSelectedToken.address)
    }

    const {
      emitUpdate = true,
      updateQuote = true,
      shouldIncrementFromAmountUpdateCounter = false
    } = updateProps || {}

    const chainId = toChainId ?? this.toChainId
    let toSelectedTokenAddr: string | undefined

    if (props.toSelectedTokenAddr && chainId) {
      this.#emitSilentErrorIfNullAddress(props.toSelectedTokenAddr)
      // if the provider is socket, convert the null addresses
      toSelectedTokenAddr = convertNullAddressToZeroAddressIfNeeded(props.toSelectedTokenAddr)
    }

    // when we init the form by using the retry button
    const shouldNotResetFromAmount =
      fromAmount && props.toSelectedTokenAddr && fromSelectedToken && toChainId

    let shouldUpdateToTokenList = false

    // fromAmountFieldMode must be set before fromAmount so it
    // works correctly when both are set at the same time
    if (fromAmountFieldMode) {
      this.fromAmountFieldMode = fromAmountFieldMode
    }

    if (shouldSetMaxAmount) {
      this.fromAmountFieldMode = 'token'
      this.#setFromAmountAmount(this.maxFromAmount, true)
    }

    if (fromAmount !== undefined) {
      this.#setFromAmountAmount(fromAmount)
    }

    if (fromAmountInFiat !== undefined) {
      this.fromAmountInFiat = fromAmountInFiat
    }

    if (shouldIncrementFromAmountUpdateCounter) {
      this.fromAmountUpdateCounter += 1
    }

    if (typeof fromSelectedToken !== 'undefined') {
      const isFromNetworkChanged = this.fromSelectedToken?.chainId !== fromSelectedToken?.chainId

      if (fromSelectedToken && isFromNetworkChanged) {
        const network = this.#networks.networks.find((n) => n.chainId === fromSelectedToken.chainId)
        if (network) {
          this.fromChainId = Number(network.chainId)
          // Don't update the selected token programmatically if the user
          // has selected it manually
          if (!this.toSelectedToken) {
            // defaults to swap after network change (should keep fromChainId and toChainId in sync after fromChainId update)
            this.toChainId = Number(network.chainId)
            shouldUpdateToTokenList = true
          }
        }
      }

      const shouldResetFromTokenAmount =
        !shouldNotResetFromAmount &&
        (isFromNetworkChanged ||
          !fromSelectedToken ||
          this.fromSelectedToken?.address !== fromSelectedToken.address)
      if (shouldResetFromTokenAmount) {
        this.#setFromAmountAndNotifyUI('')
        this.#setFromAmountInFiatAndNotifyUI('')
        this.fromAmountFieldMode = 'token'
      }

      // Always update to reflect portfolio amount (or other props) changes
      this.fromSelectedToken = fromSelectedToken
    }

    if (toChainId) {
      if (this.toChainId !== Number(toChainId)) {
        this.toChainId = Number(toChainId)
        shouldUpdateToTokenList = true
      }
    }

    const toTokensKey = this.#toTokenListKey
    const toTokenList = toTokensKey ? this.#toTokenList[toTokensKey] : undefined
    const nextToToken = toTokenList
      ? toTokenList.tokens.find((t) => t.address === toSelectedTokenAddr)
      : null

    if (nextToToken) this.toSelectedToken = { ...nextToToken }

    if (routePriority) {
      this.routePriority = routePriority
      if (this.quote) {
        this.quote = null
        this.quoteRoutesStatuses = {}
      }
    }

    if (emitUpdate) this.#emitUpdateIfNeeded()

    await Promise.all([
      shouldUpdateToTokenList
        ? // we put toSelectedTokenAddr so that "retry" btn functionality works
          this.updateToTokenList(true, nextToToken?.address || toSelectedTokenAddr)
        : undefined,
      updateQuote
        ? this.updateQuote({
            skipQuoteUpdateOnSameValues: !shouldSetMaxAmount,
            debounce: true
          })
        : undefined
    ])
  }

  resetForm(shouldEmit?: boolean) {
    // Preserve key form states instead of resetting the whole form to enhance UX and reduce confusion.
    // After form submission, maintain the state for fromSelectedToken, fromChainId, and toChainId,
    // while resetting all other state related to the form.
    this.#setFromAmountAndNotifyUI('')
    this.#setFromAmountInFiatAndNotifyUI('')
    this.fromAmountFieldMode = 'token'
    this.toSelectedToken = null
    this.quote = null
    this.updateQuoteStatus = 'INITIAL'
    this.quoteRoutesStatuses = {}
    this.destroySignAccountOp()
    this.hasProceeded = false
    this.#updateQuoteId = undefined
    this.fromAmountUpdateCounter = 0

    if (shouldEmit) this.#emitUpdateIfNeeded(true)
  }

  reset(shouldEmit?: boolean) {
    const toTokenListKey = this.#toTokenListKey

    this.resetForm()

    this.portfolioTokenList = []
    if (toTokenListKey && this.#toTokenList[toTokenListKey]) {
      this.#toTokenList[toTokenListKey].tokens = []
    }

    this.fromChainId = 1
    this.fromSelectedToken = null
    this.toChainId = 1
    this.errors = []
    this.updateQuoteInterval.stop()

    if (shouldEmit) this.#emitUpdateIfNeeded(true)
  }

  async updatePortfolioTokenList(
    nextPortfolioTokenList: TokenResult[],
    params?: {
      preselectedToken?: Pick<TokenResult, 'address' | 'chainId'>
      preselectedToToken?: Pick<TokenResult, 'address' | 'chainId'>
      fromAmount?: string
    }
  ) {
    // If the user has switched TOKEN -> NULL that would make the fromSelectedToken
    // null, so we need to keep it null, even if the portfolio token list is updated
    // until the user manually selects a new token
    const isSelectedTokenFalsyBeforeListUpdate = !this.fromSelectedToken && !!this.toSelectedToken
    const { preselectedToken, preselectedToToken, fromAmount } = params || {}
    const tokens = nextPortfolioTokenList
      .filter(
        (token) =>
          // Filtering out hidden tokens here means: 1) They won't be displayed in
          // the "From" token list (`this.portfolioTokenList`) and 2) They won't be
          // added to the "Receive" token list as additional tokens from portfolio,
          // BUT 3) They will appear in the "Receive" if they are present in service
          // provider's to token list. This is the desired behavior.
          getIsTokenEligibleForSwapAndBridge(token) && !token.flags.isHidden
      )
      .map((token) => ({
        ...token,
        address: mapBannedToValidAddr(Number(token.chainId), token.address)
      }))

    this.portfolioTokenList = sortPortfolioTokenList(tokens)

    const fromSelectedTokenInNextPortfolio = this.portfolioTokenList.find((t) => {
      if (preselectedToken) {
        return t.address === preselectedToken.address && t.chainId === preselectedToken.chainId
      }

      return (
        t.address === this.fromSelectedToken?.address &&
        t.chainId === this.fromSelectedToken?.chainId
      )
    })

    const shouldUpdateFromSelectedToken =
      !this.fromSelectedToken || // initial (default) state
      // May happen if selected account gets changed or the token gets send away in the meantime
      !fromSelectedTokenInNextPortfolio ||
      // May happen if user receives or sends the token in the meantime
      fromSelectedTokenInNextPortfolio.amount !== this.fromSelectedToken?.amount ||
      preselectedToken

    // If the token is not in the portfolio because it was a "to" token
    // and the user has switched the "from" and "to" tokens we should not
    // update the selected token
    if (
      !this.fromSelectedToken?.isSwitchedToToken &&
      !isSelectedTokenFalsyBeforeListUpdate &&
      shouldUpdateFromSelectedToken
    ) {
      const nextFromSelectedToken =
        fromSelectedTokenInNextPortfolio ||
        // Select the first token in the portfolio that is not the same as the "to" token
        this.portfolioTokenList.find(
          (t) =>
            t.address !== this.toSelectedToken?.address &&
            this.supportedChainIds.includes(t.chainId)
        ) ||
        null

      await this.updateForm(
        {
          fromSelectedToken: nextFromSelectedToken,
          toSelectedTokenAddr: preselectedToToken?.address,
          toChainId: preselectedToToken?.chainId,
          fromAmount
        },
        {
          emitUpdate: false,
          shouldIncrementFromAmountUpdateCounter: true
        }
      )
      return
    }
    this.#addFromTokenToPortfolioListIfNeeded()

    this.#emitUpdateIfNeeded()
  }

  async updateToTokenList(shouldReset: boolean, addressToSelect?: string) {
    const fromChainId = this.fromChainId
    const toChainId = this.toChainId
    const toTokenListKeyAtStart = this.#toTokenListKey

    if (!toTokenListKeyAtStart || !fromChainId || !toChainId) return

    let toTokenList = this.#toTokenList[toTokenListKeyAtStart]

    // Prevent updating the same token list twice
    if (toTokenList?.status === 'LOADING') {
      return
    }

    // Create the list if it doesn’t exist yet, or set its status to LOADING if it does.
    if (!toTokenList) {
      this.#toTokenList[toTokenListKeyAtStart] = {
        status: 'LOADING',
        apiTokens: [],
        tokens: [],
        lastUpdate: 0
      }

      toTokenList = this.#toTokenList[toTokenListKeyAtStart]
    } else {
      toTokenList.status = 'LOADING'
    }

    if (shouldReset) {
      this.toSelectedToken = null
    }

    this.removeError('to-token-list-fetch-failed', false)

    // Emit an update to set the loading state in the UI
    this.#emitUpdateIfNeeded()

    const now = Date.now()

    const shouldFetchTokenList =
      !toTokenList.apiTokens.length || now - toTokenList.lastUpdate >= TO_TOKEN_LIST_CACHE_THRESHOLD

    if (shouldFetchTokenList) {
      try {
        toTokenList.apiTokens = await this.#serviceProviderAPI.getToTokenList({
          fromChainId,
          toChainId
        })
        toTokenList.lastUpdate = Date.now()
      } catch (error: any) {
        // Display an error only if there is no cached data
        if (!toTokenList.apiTokens.length) {
          const { message } = getHumanReadableSwapAndBridgeError(error)

          this.addOrUpdateError({
            id: 'to-token-list-fetch-failed',
            title: 'Token list on the receiving network is temporarily unavailable.',
            text: message,
            level: 'error'
          })
        }
      }
    }

    toTokenList.tokens = this.#getToTokens(fromChainId, toChainId)

    const toTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === toChainId)
    // should never happen
    if (!toTokenNetwork) {
      toTokenList.status = 'INITIAL'
      this.#emitUpdateIfNeeded()
      throw new SwapAndBridgeError(NETWORK_MISMATCH_MESSAGE)
    }

    if (toTokenListKeyAtStart === this.#toTokenListKey && !this.toSelectedToken) {
      if (addressToSelect) {
        const token = toTokenList.tokens.find((t) => t.address === addressToSelect)
        if (token) {
          await this.updateForm({ toSelectedTokenAddr: token.address }, { emitUpdate: false })
          this.#emitUpdateIfNeeded()
        }
      }
    }

    toTokenList.status = 'INITIAL'
    this.#emitUpdateIfNeeded()
  }

  /**
   * Returns the short list of tokens for the "to" token list, because the full
   * list (stored in #toTokenList) could be HUGE, causing the controller to be
   * HUGE as well, that leads to performance problems.
   */
  get toTokenShortList(): SwapAndBridgeToToken[] {
    const toTokenListKey = this.#toTokenListKey
    const fromChainId = this.fromChainId
    const toChainId = this.toChainId

    if (!toTokenListKey || !fromChainId || !toChainId) return []

    const tokens = this.#toTokenList[toTokenListKey]?.tokens || []

    const isSwapping = fromChainId === toChainId
    if (isSwapping) {
      return (
        tokens
          // Swaps between same "from" and "to" tokens are not feasible, filter them out
          .filter((t) => t.address !== this.fromSelectedToken?.address)
          .slice(0, TO_TOKEN_LIST_LIMIT)
      )
    }

    return tokens.slice(0, TO_TOKEN_LIST_LIMIT)
  }

  #getToTokens(fromChainId: number | null, toChainId: number | null) {
    const toTokenListKey = SwapAndBridgeController.getToTokenListKey(fromChainId, toChainId)

    if (!toTokenListKey || !fromChainId || !toChainId) return []

    const apiTokens =
      this.#toTokenList[toTokenListKey]?.apiTokens ||
      addCustomTokensIfNeeded({
        chainId: toChainId,
        tokens: []
      })
    const portfolioTokens = this.portfolioTokenList.filter((t) => t.chainId === BigInt(toChainId))

    const additionalTokensFromPortfolio = portfolioTokens
      .filter((token) => !apiTokens.some((t) => t.address === token.address))
      .map((t) => convertPortfolioTokenToSwapAndBridgeToToken(t, toChainId))

    const chainBannedTokens: string[] = getBannedToTokenList(toChainId.toString())

    return sortTokenListResponse(
      [...apiTokens, ...additionalTokensFromPortfolio],
      portfolioTokens
    ).filter((t) => !chainBannedTokens.includes(getAddress(t.address)))
  }

  get updateToTokenListStatus() {
    const toTokenListKey = this.#toTokenListKey

    if (!toTokenListKey) return 'INITIAL'

    const toTokenList = this.#toTokenList[toTokenListKey]

    if (!toTokenList) return 'INITIAL'

    return toTokenList.status
  }

  async #addToTokenByAddress(address: string) {
    if (!this.toChainId) return // should never happen
    if (!isAddress(address)) return // no need to attempt with invalid addresses

    const toTokenListKey = this.#toTokenListKey

    if (!toTokenListKey || !this.#toTokenList[toTokenListKey]) return

    const tokenList = this.#toTokenList[toTokenListKey]

    const isAlreadyInTheList = tokenList.tokens.some(
      // Compare lowercase, address param comes from a search term that is lowercased
      (t) => t.address.toLowerCase() === address.toLowerCase()
    )
    if (isAlreadyInTheList) return

    let token: SwapAndBridgeToToken | null
    try {
      token = await this.#serviceProviderAPI.getToken({ address, chainId: this.toChainId })

      if (!token)
        throw new SwapAndBridgeError(
          'Token with this address is not supported by our service provider.'
        )
    } catch (error: any) {
      const { message } = getHumanReadableSwapAndBridgeError(error)
      throw new EmittableError({ error, level: 'minor', message })
    }

    if (toTokenListKey)
      // Cache for sometime the tokens added by address
      tokenList.apiTokens.push(token)

    tokenList.tokens.push(token)

    const toTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === this.toChainId)
    // should never happen
    if (!toTokenNetwork) {
      const error = new SwapAndBridgeError(NETWORK_MISMATCH_MESSAGE)
      throw new EmittableError({ error, level: 'minor', message: error?.message })
    }

    tokenList.tokens = sortTokenListResponse(
      tokenList.tokens,
      this.portfolioTokenList.filter((t) => t.chainId === toTokenNetwork.chainId)
    )

    // Re-trigger search, because of the updated #toTokenList
    await this.searchToToken(token.address)

    this.#emitUpdateIfNeeded()
    return token
  }

  #getIsWrapOrUnwrap(): boolean {
    const fromSelectedToken = this.fromSelectedToken
    const toSelectedToken = this.toSelectedToken

    if (!toSelectedToken || !fromSelectedToken) return false

    const isSameChain = this.fromChainId === this.toChainId

    if (!isSameChain) return false

    const fromAddr = fromSelectedToken.address.toLowerCase()
    const toAddr = toSelectedToken.address.toLowerCase()

    if (fromAddr !== ZeroAddress && toAddr !== ZeroAddress) return false

    const networkData = this.#networks.networks.find((n) => n.chainId === fromSelectedToken.chainId)

    if (!networkData) return false

    const nativeWrappedAddress = networkData.wrappedAddr?.toLowerCase()
    const isWrap = fromAddr === ZeroAddress && toAddr === nativeWrappedAddress
    const isUnwrap = fromAddr === nativeWrappedAddress && toAddr === ZeroAddress

    return isWrap || isUnwrap
  }

  #accountNativeBalance(amount: bigint): bigint {
    if (!this.#selectedAccount.account || !this.fromChainId) return 0n

    const currentPortfolio = this.#portfolio.getAccountPortfolioState(
      this.#selectedAccount.account.addr
    )
    const currentPortfolioNetwork = currentPortfolio[this.fromChainId.toString()]
    const native = currentPortfolioNetwork?.result?.tokens.find(
      (token) => token.address === '0x0000000000000000000000000000000000000000'
    )
    if (!native) return 0n

    if (this.fromSelectedToken?.address !== ZeroAddress) return native.amount

    // subtract the from amount from the portfolio available balance
    if (amount > native.amount) return 0n
    return native.amount - amount
  }

  /**
   * Add the selected token to the portfolio token list if needed. This is
   * necessary because the user may switch the "from" and "to" tokens, and the
   * to token may be a token that is not in the portfolio token list.
   */
  #addFromTokenToPortfolioListIfNeeded() {
    if (!this.fromSelectedToken) return

    const isAlreadyInTheList = this.portfolioTokenList.some(
      (t) =>
        t.address === this.fromSelectedToken!.address &&
        t.chainId === this.fromSelectedToken!.chainId
    )

    if (isAlreadyInTheList || !this.fromSelectedToken.isSwitchedToToken) return

    this.portfolioTokenList = [...this.portfolioTokenList, this.fromSelectedToken]
  }

  addToTokenByAddress = async (address: string) =>
    this.withStatus('addToTokenByAddress', () => this.#addToTokenByAddress(address), true)

  async searchToToken(searchTerm: string) {
    // Reset the search results
    this.toTokenSearchTerm = ''
    this.toTokenSearchResults = []
    this.#emitUpdateIfNeeded()

    if (!searchTerm) return // should never happen

    if (!this.#toTokenListKey || !this.#toTokenList[this.#toTokenListKey]) return

    const normalizedSearchTerm = searchTerm.trim().toLowerCase()
    this.toTokenSearchTerm = normalizedSearchTerm

    const tokens = this.#toTokenList[this.#toTokenListKey]?.tokens || []

    const { exactMatches, partialMatches } = tokens.reduce(
      (result, token) => {
        // Filter out the from token if swapping on the same chain
        if (
          this.toChainId &&
          this.fromChainId === this.toChainId &&
          token.address === this.fromSelectedToken?.address
        )
          return result

        const fieldsToSearch = [
          token.address.toLowerCase(),
          token.symbol.toLowerCase(),
          token.name.toLowerCase()
        ]

        // Prioritize exact matches, partial matches come after
        const isExactMatch = fieldsToSearch.some((field) => field === normalizedSearchTerm)
        const isPartialMatch = fieldsToSearch.some((field) => field.includes(normalizedSearchTerm))

        if (isExactMatch) {
          result.exactMatches.push(token)
        } else if (isPartialMatch) {
          result.partialMatches.push(token)
        }

        return result
      },
      { exactMatches: [] as SwapAndBridgeToToken[], partialMatches: [] as SwapAndBridgeToToken[] }
    )

    this.toTokenSearchResults = [...exactMatches, ...partialMatches].slice(0, TO_TOKEN_LIST_LIMIT)
    this.#emitUpdateIfNeeded()
  }

  async switchFromAndToTokens() {
    this.switchTokensStatus = 'LOADING'
    this.#emitUpdateIfNeeded()

    const prevFromSelectedToken = this.fromSelectedToken ? { ...this.fromSelectedToken } : null
    // Update the from token
    if (!this.toSelectedToken) {
      await this.updateForm(
        {
          fromAmount: '',
          fromAmountFieldMode: 'token',
          toSelectedTokenAddr: this.fromSelectedToken?.address || null
        },
        {
          emitUpdate: false,
          updateQuote: false,
          shouldIncrementFromAmountUpdateCounter: true
        }
      )
      this.fromSelectedToken = null
    } else if (this.toChainId) {
      const toSelectedTokenNetwork = this.#networks.networks.find(
        (n) => Number(n.chainId) === this.toChainId
      )!
      const tokenInPortfolio = this.portfolioTokenList.find(
        (token: TokenResult) =>
          token.chainId === toSelectedTokenNetwork.chainId &&
          token.address === this.toSelectedToken?.address
      )

      const price = Number(this.quote?.selectedRoute?.toToken?.priceUSD || 0)

      this.fromSelectedToken = tokenInPortfolio || {
        ...this.toSelectedToken,
        chainId: BigInt(this.toChainId),
        amount: 0n,
        flags: {
          onGasTank: false,
          isFeeToken: false,
          canTopUpGasTank: false,
          rewardsType: null
        },
        priceIn: price ? [{ baseCurrency: 'usd', price }] : []
      }

      this.fromSelectedToken.isSwitchedToToken = true
      this.#addFromTokenToPortfolioListIfNeeded()

      // Update the amount to the one from the quote
      let fromAmount = ''
      // Try catch just in case because of formatUnits
      try {
        if (this.quote && this.quote.selectedRoute?.fromAmount) {
          fromAmount = formatUnits(
            this.quote.selectedRoute.toAmount,
            this.quote.selectedRoute.toToken.decimals
          )
        }
      } catch (error) {
        console.error('Error formatting fromAmount', error)
      }
      await this.updateForm(
        {
          fromAmount,
          fromAmountFieldMode: 'token'
        },
        {
          emitUpdate: false,
          updateQuote: false,
          shouldIncrementFromAmountUpdateCounter: true
        }
      )
    }

    // Update the chain ids
    ;[this.fromChainId, this.toChainId] = [this.toChainId, this.fromChainId]

    // Update the to token list
    await this.updateToTokenList(true, prevFromSelectedToken?.address)

    this.switchTokensStatus = 'INITIAL'
    this.#emitUpdateIfNeeded()
  }

  async updateQuote(options?: {
    skipQuoteUpdateOnSameValues?: boolean
    skipPreviousQuoteRemoval?: boolean
    skipStatusUpdate?: boolean
    debounce?: boolean
  }) {
    const {
      skipQuoteUpdateOnSameValues = true,
      skipPreviousQuoteRemoval = false,
      skipStatusUpdate = false,
      debounce = false
    } = options || {}
    // no updates if the user has commited
    if (this.formStatus === SwapAndBridgeFormStatus.Proceeded) return

    // no quote fetch if there are errors
    if (this.swapSignErrors.length) return

    const quoteId = generateUuid()
    this.#updateQuoteId = quoteId

    const updateQuoteFunction = async (): Promise<boolean | undefined> => {
      if (!this.#selectedAccount.account) return
      if (!this.#getIsFormValidToFetchQuote()) return
      if (!this.fromAmount || !this.fromSelectedToken || !this.toSelectedToken) return

      const bigintFromAmount = parseUnits(
        getSafeAmountFromFieldValue(this.fromAmount, this.fromSelectedToken.decimals),
        this.fromSelectedToken.decimals
      )

      if (this.quote) {
        const isFromAmountSame =
          this.quote.selectedRoute?.fromAmount === bigintFromAmount.toString()
        const isFromNetworkSame = this.quote.fromChainId === this.fromChainId
        const isFromAddressSame = this.quote.fromAsset.address === this.fromSelectedToken.address
        const isToNetworkSame = this.quote.toChainId === this.toChainId
        const isToAddressSame = this.quote.toAsset.address === this.toSelectedToken.address

        if (
          skipQuoteUpdateOnSameValues &&
          isFromAmountSame &&
          isFromNetworkSame &&
          isFromAddressSame &&
          isToNetworkSame &&
          isToAddressSame
        ) {
          // We consider reusing the same quote a success (hence we return true).
          // Otherwise, at the end of `updateQuote`, if we treat it as a falsy value,
          // the quote will be reset and the signAccountOp will be destroyed,
          // which is incorrect behavior, given that we already have a valid quote.
          return true
        }
      }
      if (!skipPreviousQuoteRemoval) {
        if (this.quote) {
          this.quote = null
          this.updateQuoteStatus = 'LOADING'
        }
        this.quoteRoutesStatuses = {}
        this.#emitUpdateIfNeeded()
      }

      try {
        const network = this.#networks.networks.find((n) => Number(n.chainId) === this.fromChainId!)
        const isWrapOrUnwrap = this.#getIsWrapOrUnwrap()

        const quoteResult = await this.#serviceProviderAPI.quote({
          fromAsset: this.fromSelectedToken,
          fromChainId: this.fromChainId!,
          fromTokenAddress: this.fromSelectedToken.address,
          toAsset: this.toSelectedToken,
          toChainId: this.toChainId!,
          toTokenAddress: this.toSelectedToken.address,
          fromAmount: bigintFromAmount,
          userAddress: this.#selectedAccount.account.addr,
          sort: this.routePriority,
          isWrapOrUnwrap,
          accountNativeBalance: this.#accountNativeBalance(bigintFromAmount),
          nativeSymbol: network?.nativeAssetSymbol || 'ETH'
        })
        // sort the routes by value and them by disabled, making disabled last
        quoteResult.routes = quoteResult.routes
          .filter((route) => {
            const hasNoRouteId = !route.routeId

            if (hasNoRouteId) {
              this.emitError({
                level: 'silent',
                error: new SwapAndBridgeError(
                  `Received route with no routeId from ${this.#serviceProviderAPI.name}. From: ${
                    this.fromSelectedToken?.address
                  } (${this.fromSelectedToken?.chainId}) To: ${this.toSelectedToken?.address} (${
                    this.toSelectedToken?.chainId
                  })`
                ),
                message: 'Received route with no routeId'
              })
            }

            return !hasNoRouteId
          })
          .sort((r1, r2) => {
            const isBridge = r1.fromChainId !== r1.toChainId

            // the amount threshold in %. If below, we check the time as
            // the deciding sort factor
            const threshold = 1.2

            const sortByTime = () => {
              const aTime = Number(r1.serviceTime)
              const bTime = Number(r2.serviceTime)
              if (aTime === bTime) return 0
              if (aTime > bTime) return 1
              return -1
            }

            const sortByAmountAndTime = () => {
              const a = BigInt(r1.toAmount)
              const b = BigInt(r2.toAmount)

              // if value is the same, check time if bridge
              if (a === b) {
                if (!isBridge) return 0
                return sortByTime()
              }

              const aUsd = Number(r1.outputValueInUsd ?? 0)
              const bUsd = Number(r2.outputValueInUsd ?? 0)
              if (a > b) {
                // if it's not a bridge, just return the higher output route
                if (!isBridge) return -1

                // if the bigint amount says a > b but the usd amount says
                // the opposite, we're stuck, so just return a as the winner
                if (bUsd > aUsd || aUsd === 0) return -1

                const percentage = ((aUsd - bUsd) / aUsd) * 100
                if (percentage < threshold) return sortByTime()
                return -1
              }

              // if it's not a bridge, just return the higher output route
              if (!isBridge) return 1

              // if the bigint amount says b > a but the usd amount says
              // the opposite, we're stuck, so just return b as the winner
              if (aUsd > bUsd || bUsd === 0) return 1
              const percentage = ((bUsd - aUsd) / bUsd) * 100
              if (percentage < threshold) return sortByTime()
              return 1
            }

            // move the routes with service fee to the bottom
            const r1ServiceFee = r1.serviceFee && Number(r1.serviceFee.amountUSD) > 0
            const r2ServiceFee = r2.serviceFee && Number(r2.serviceFee.amountUSD) > 0
            if (r1ServiceFee && !r2ServiceFee) return 1
            if (r2ServiceFee && !r1ServiceFee) return -1
            return sortByAmountAndTime()
          })
          .sort((a, b) => Number(a.disabled === true) - Number(b.disabled === true))
        // select the first enabled route
        quoteResult.selectedRoute = quoteResult.routes.length ? quoteResult.routes[0] : undefined
        quoteResult.selectedRouteSteps = quoteResult.selectedRoute
          ? quoteResult.selectedRoute.steps
          : []

        if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteId)) return
        // no updates if the user has commited
        if (this.formStatus === SwapAndBridgeFormStatus.Proceeded) return

        if (
          this.#getIsFormValidToFetchQuote() &&
          quoteResult &&
          quoteResult.fromChainId === this.fromChainId &&
          quoteResult.toChainId === this.toChainId &&
          quoteResult.toAsset.address === this.toSelectedToken?.address
        ) {
          const routes = quoteResult.routes || []
          if (!routes.length || !quoteResult.selectedRoute) {
            this.quote = null
            return
          }

          this.quote = {
            fromAsset: quoteResult.fromAsset,
            fromChainId: quoteResult.fromChainId,
            toAsset: quoteResult.toAsset,
            toChainId: quoteResult.toChainId,
            selectedRoute: quoteResult.selectedRoute,
            selectedRouteSteps: quoteResult.selectedRoute.steps,
            routes,
            withConvenienceFee: quoteResult.withConvenienceFee
          }
        }
        this.quoteRoutesStatuses = (quoteResult as any).bridgeRouteErrors || {}

        return true
      } catch (error: any) {
        if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteId)) return

        const { message } = getHumanReadableSwapAndBridgeError(error)
        this.emitError({ error, level: 'major', message })

        return false
      }
    }

    if (!this.#getIsFormValidToFetchQuote()) {
      if (this.quote || this.quoteRoutesStatuses) {
        this.#resetQuote()
      }
      return
    }

    if (!skipStatusUpdate) {
      this.updateQuoteStatus = 'LOADING'
      this.removeError('no-routes')
      this.removeError('all-routes-failed')
      this.#emitUpdateIfNeeded()
    }

    // Debounce the updateQuote function to avoid multiple calls
    if (debounce) await wait(500)
    if (this.#updateQuoteId !== quoteId) return

    const isSuccessful = await updateQuoteFunction()

    if (this.#updateQuoteId !== quoteId) return

    this.updateQuoteStatus = 'INITIAL'
    this.#emitUpdateIfNeeded()

    if (isSuccessful) {
      await this.initSignAccountOpIfNeeded(quoteId)
    } else {
      // When destroying the signAccountOp, we must also reset the quote and its status;
      // otherwise, the toToken state remains stuck in a loading state.
      // This ensures the user can retry fetching the quote.
      this.destroySignAccountOp()
      this.#resetQuote()
    }
    this.updateQuoteInterval.restart()
  }

  #resetQuote() {
    this.quote = null
    this.quoteRoutesStatuses = {}
    this.updateQuoteStatus = 'INITIAL'
    this.removeError('no-routes')
    this.removeError('all-routes-failed')
    this.#emitUpdateIfNeeded()
  }

  async getRouteStartUserTx(): Promise<
    | (
        | (SwapAndBridgeSendTxRequest & { success: true })
        | (SwapAndBridgeErrorType & { success: false })
      )
    | null
  > {
    if (
      this.formStatus !== SwapAndBridgeFormStatus.ReadyToEstimate &&
      this.formStatus !== SwapAndBridgeFormStatus.ReadyToSubmit
    )
      return null

    if (!this.quote || !this.quote.selectedRoute) return null

    try {
      const routeResult = await this.#serviceProviderAPI.startRoute(this.quote.selectedRoute)
      return {
        ...routeResult,
        activeRouteId: this.quote.selectedRoute.routeId,
        success: true
      }
    } catch (error: any) {
      const humanizedError = getHumanReadableSwapAndBridgeError(error)

      // Display the error in the UI only if it has a shortMessage
      // as we don't have much space and there is a default error message
      if (
        'shortMessage' in humanizedError &&
        humanizedError.shortMessage &&
        typeof humanizedError.shortMessage === 'string'
      ) {
        return {
          success: false,
          id: 'no-routes',
          title: humanizedError.shortMessage,
          level: 'error'
        }
      }

      return null
    }
  }

  async checkForActiveRoutesStatusUpdate() {
    await this.#initialLoadPromise
    const fetchAndUpdateRoute = async (activeRoute: SwapAndBridgeActiveRoute) => {
      let status: SwapAndBridgeRouteStatus = null

      if (!activeRoute.userTxHash || activeRoute.routeStatus === 'completed') return

      const latestSubmittedAccountOps = this.#activity.getAccountOpsForAccount({
        accountAddr: activeRoute.sender,
        from: 0,
        numberOfItems: 10
      })

      const activeRouteSubmittedAccountOp = latestSubmittedAccountOps.find(
        (op) => op.txnId === activeRoute.userTxHash
      )

      if (!activeRouteSubmittedAccountOp) return

      try {
        // should never happen
        if (!activeRoute.route) throw new Error('Route data is missing.')

        status = await this.#serviceProviderAPI.getRouteStatus({
          fromChainId: activeRoute.route.fromChainId,
          toChainId: activeRoute.route.toChainId,
          bridge: activeRoute.route.usedBridgeNames?.[0],
          txHash: activeRoute.userTxHash!,
          providerId: activeRoute.route.providerId
        })
      } catch (e: any) {
        const { message } = getHumanReadableSwapAndBridgeError(e)
        this.updateActiveRoute(activeRoute.activeRouteId, { error: message })
        return
      }

      // prevent race condition in case there is a newer update
      if (
        this.#continuouslyUpdateActiveRoutesSessionId !== this.#getActiveRoutesInProgressSessionId()
      ) {
        return
      }

      const route = this.activeRoutes.find((r) => r.activeRouteId === activeRoute.activeRouteId)
      if (route?.error) {
        this.updateActiveRoute(activeRoute.activeRouteId, {
          error: undefined
        })
      }

      if (status === 'completed') {
        this.updateActiveRoute(
          activeRoute.activeRouteId,
          {
            routeStatus: 'completed',
            error: undefined
          },
          true
        )
        if (
          this.#portfolioUpdate &&
          activeRoute.route.fromChainId !== activeRoute.route.toChainId
        ) {
          this.#portfolioUpdate([BigInt(activeRoute.route.toChainId)])
        }
      } else if (status === 'ready') {
        this.updateActiveRoute(
          activeRoute.activeRouteId,
          {
            routeStatus: 'ready',
            error: undefined
          },
          true
        )
      } else if (status === 'refunded') {
        this.updateActiveRoute(
          activeRoute.activeRouteId,
          {
            routeStatus: 'refunded',
            error: undefined
          },
          true
        )
      }
    }

    await Promise.all(
      this.activeRoutesInProgress.map(async (route) => {
        await fetchAndUpdateRoute(route)
      })
    )
  }

  async selectRoute(
    route: SwapAndBridgeRoute,
    opts?: {
      isManualSelection?: boolean
    }
  ) {
    const { isManualSelection = false } = opts || {}
    if (!this.quote || !this.quote.routes.length) return
    if (
      ![
        SwapAndBridgeFormStatus.ReadyToSubmit,
        SwapAndBridgeFormStatus.ReadyToEstimate,
        SwapAndBridgeFormStatus.InvalidRouteSelected
      ].includes(this.formStatus)
    )
      return

    this.quote.selectedRoute = route
    this.quote.selectedRouteSteps = route.steps
    if (isManualSelection) this.quote.selectedRoute.isSelectedManually = true

    if (this.#updateQuoteId) await this.initSignAccountOpIfNeeded(this.#updateQuoteId)
    this.emitUpdate()
  }

  addActiveRoute({ userTxIndex }: { userTxIndex: SwapAndBridgeSendTxRequest['userTxIndex'] }) {
    if (!this.quote || !this.quote.selectedRoute) {
      const message = 'Unexpected swap & bridge error: no quote found. Please contact support'
      throw new EmittableError({ error: new Error(message), level: 'major', message })
    }

    try {
      const route = this.quote.selectedRoute
      this.activeRoutes.push({
        serviceProviderId: this.quote.selectedRoute.providerId,
        activeRouteId: route.routeId.toString(),
        userTxIndex,
        routeStatus: 'ready',
        userTxHash: null,
        fromAsset: {
          ...this.quote.fromAsset,
          icon: this.quote.fromAsset.icon || '',
          logoURI: this.quote.fromAsset.icon || ''
        },
        toAsset: {
          ...this.quote.toAsset,
          icon: this.quote.toAsset.icon || '',
          logoURI: this.quote.toAsset.icon || ''
        },
        fromAssetAddress: this.quote.fromAsset.address,
        toAssetAddress: this.quote.toAsset.address,
        steps: route.steps,
        sender: route.userAddress,
        identifiedBy: null,
        route: {
          ...route,
          routeStatus: 'ready',
          transactionData: null
        }
      })

      this.emitUpdate()
    } catch (error: any) {
      const { message } = getHumanReadableSwapAndBridgeError(error)
      throw new EmittableError({ error, level: 'major', message })
    }
  }

  updateActiveRoute(
    activeRouteId: SwapAndBridgeActiveRoute['activeRouteId'],
    activeRoute?: Partial<SwapAndBridgeActiveRoute>,
    forceUpdateRoute?: boolean
  ) {
    const currentActiveRoutes = [...this.activeRoutes]
    const activeRouteIndex = currentActiveRoutes.findIndex((r) => r.activeRouteId === activeRouteId)

    if (activeRouteIndex !== -1) {
      if (forceUpdateRoute) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        ;(async () => {
          const route = currentActiveRoutes[activeRouteIndex].route
          this.updateActiveRoute(activeRouteId, { route })
        })()
      }

      if (activeRoute) {
        currentActiveRoutes[activeRouteIndex] = {
          ...currentActiveRoutes[activeRouteIndex],
          ...activeRoute
        }
      } else {
        currentActiveRoutes[activeRouteIndex] = { ...currentActiveRoutes[activeRouteIndex] }
      }

      if (activeRoute?.routeStatus === 'completed' || activeRoute?.routeStatus === 'refunded') {
        // Change the currentUserTxIndex to the length of the userTxs array
        // a.k.a. all transactions are completed
        const activeRouteRoute = currentActiveRoutes[activeRouteIndex].route

        if (activeRouteRoute) {
          activeRouteRoute.currentUserTxIndex = activeRouteRoute.userTxs.length
        }
      } else if (activeRoute?.userTxHash) {
        // Mark all source destination actions as completed
        // when the transaction is mined
        const activeRouteRoute = currentActiveRoutes[activeRouteIndex].route

        if (activeRouteRoute) {
          activeRouteRoute.currentUserTxIndex = activeRouteRoute.userTxs.filter(
            (tx) => !isTxnBridge(tx)
          ).length
        }
      }

      this.activeRoutes = currentActiveRoutes

      this.#emitUpdateIfNeeded()
    }
  }

  removeActiveRoute(
    activeRouteId: SwapAndBridgeSendTxRequest['activeRouteId'],
    shouldEmitUpdate: boolean = true
  ) {
    this.activeRoutes = this.activeRoutes.filter((r) => r.activeRouteId !== activeRouteId)

    // Purposely not using `this.#emitUpdateIfNeeded()` here, as this should always emit to update banners
    if (shouldEmitUpdate) this.emitUpdate()
  }

  /**
   * Find the next route in line and try to re-estimate with it
   */
  async onEstimationFailure(activeRouteId?: SwapAndBridgeSendTxRequest['activeRouteId']) {
    if (!this.quote || !this.quote.selectedRoute || this.quote.selectedRoute.isSelectedManually)
      return

    const routeId = activeRouteId ?? this.quote.selectedRoute.routeId
    let routeIndex = null
    this.quote.routes.forEach((route, i) => {
      if (route.routeId === routeId) routeIndex = i
    })

    // this shouldn't happen; there's no reason for the activeRouteId to not be
    // present in the this.quote.routes;
    // however, just to be on the safe side if it ever were to happen, reset all
    if (routeIndex === null) {
      this.quote.selectedRoute = undefined
      this.quote.routes = []
      this.updateQuoteStatus = 'INITIAL'
      this.emitUpdate()
      return
    }

    const firstEnabledRoute = this.quote.routes.find((r) => !r.disabled)
    if (!firstEnabledRoute) {
      this.updateQuoteStatus = 'INITIAL'
      this.emitUpdate()
      return
    }

    // push the failed route to the end of the routes array
    // and select the next one
    const route = this.quote.routes[routeIndex]
    this.quote.routes.splice(routeIndex, 1)
    this.quote.routes.push(route)
    await this.selectRoute(firstEnabledRoute)
  }

  /**
   * We need this as a separate method as it's called from the UI as well
   */
  async markSelectedRouteAsFailed(disabledReason: string) {
    if (!this.quote || !this.quote.selectedRoute) return

    this.quote.selectedRoute.disabled = true
    this.quote.selectedRoute.disabledReason = disabledReason

    const routeId = this.quote.selectedRoute.routeId
    this.quote.routes.forEach((route, i) => {
      if (route.routeId === routeId) {
        this.quote!.routes[i].disabled = true
        this.quote!.routes[i].disabledReason = disabledReason
      }
    })
  }

  // update active route if needed on SubmittedAccountOp update
  handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(op: SubmittedAccountOp) {
    op.calls.forEach((call) => {
      this.#handleActiveRouteBroadcastedTransaction(call.id, op.status)
      this.#handleActiveRouteBroadcastedApproval(call.id, op.status)
      this.#handleActiveRoutesWithReadyApproval(call.id, op.status)
      this.#handleUpdateActiveRoutesUserTxData(call.id, op)
      this.#handleActiveRoutesCompleted(call.id, op.status)
    })
  }

  #handleActiveRouteBroadcastedTransaction(
    callId: Call['id'],
    opStatus: SubmittedAccountOp['status']
  ) {
    if (opStatus !== AccountOpStatus.BroadcastedButNotConfirmed) return

    const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === callId)
    if (!activeRoute) return

    // learn the additional step tokens so if the route fails alongs the way,
    // the user has the token learnt in his portfolio
    activeRoute.route?.steps.forEach((step) => {
      this.#portfolio.addTokensToBeLearned([step.toAsset.address], BigInt(step.toAsset.chainId))
    })

    this.updateActiveRoute(activeRoute.activeRouteId, { routeStatus: 'in-progress' })
  }

  #handleActiveRouteBroadcastedApproval(
    callId: Call['id'],
    opStatus: SubmittedAccountOp['status']
  ) {
    if (opStatus !== AccountOpStatus.BroadcastedButNotConfirmed) return

    const activeRoute = this.activeRoutes.find((r) => `${r.activeRouteId}-approval` === callId)
    if (!activeRoute) return

    this.updateActiveRoute(activeRoute.activeRouteId, {
      routeStatus: 'waiting-approval-to-resolve'
    })
  }

  #handleActiveRoutesWithReadyApproval(callId: Call['id'], opStatus: SubmittedAccountOp['status']) {
    const activeRouteWaitingApproval = this.activeRoutes.find(
      (r) =>
        r.routeStatus === 'waiting-approval-to-resolve' && `${r.activeRouteId}-approval` === callId
    )

    if (!activeRouteWaitingApproval) return

    if (opStatus === AccountOpStatus.Success) {
      this.updateActiveRoute(activeRouteWaitingApproval.activeRouteId, {
        routeStatus: 'ready'
      })
    }

    if (opStatus === AccountOpStatus.Failure || opStatus === AccountOpStatus.Rejected) {
      const errorMessage =
        opStatus === AccountOpStatus.Rejected
          ? 'The approval was rejected but you can try to sign it again'
          : 'The approval failed but you can try to sign it again'
      this.updateActiveRoute(activeRouteWaitingApproval.activeRouteId, {
        routeStatus: 'ready',
        error: errorMessage
      })
    }
  }

  #handleUpdateActiveRoutesUserTxData(callId: Call['id'], submittedAccountOp: SubmittedAccountOp) {
    const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === callId)
    if (!activeRoute) return

    if (submittedAccountOp && !activeRoute.userTxHash) {
      this.updateActiveRoute(activeRoute.activeRouteId, {
        userTxHash: submittedAccountOp?.txnId,
        identifiedBy: submittedAccountOp.identifiedBy
      })
    }
  }

  #handleActiveRoutesCompleted(callId: Call['id'], opStatus: SubmittedAccountOp['status']) {
    const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === callId)
    if (!activeRoute || !activeRoute.route) return

    let shouldUpdateActiveRouteStatus = false

    const isSwap = activeRoute.route.fromChainId === activeRoute.route.toChainId

    // force update the active route status if the route is of type 'swap'
    if (isSwap) shouldUpdateActiveRouteStatus = true

    // force update the active route with an error message if the tx fails (for both swap and bridge)
    if (opStatus === AccountOpStatus.Failure || opStatus === AccountOpStatus.Rejected)
      shouldUpdateActiveRouteStatus = true

    if (!shouldUpdateActiveRouteStatus) return

    if (opStatus === AccountOpStatus.Success) {
      this.updateActiveRoute(activeRoute.activeRouteId, { routeStatus: 'completed' })
      return
    }

    // If the transaction fails, update the status to "ready" to allow the user to sign it again
    if (opStatus === AccountOpStatus.Failure || opStatus === AccountOpStatus.Rejected) {
      const errorMessage =
        opStatus === AccountOpStatus.Rejected
          ? 'The transaction was rejected'
          : 'The transaction failed onchain'
      this.updateActiveRoute(activeRoute.activeRouteId, {
        routeStatus: 'failed',
        error: errorMessage
      })
    }
  }

  #getIsFormValidToFetchQuote() {
    return (
      this.fromChainId &&
      this.toChainId &&
      !!getSafeAmountFromFieldValue(this.fromAmount, this.fromSelectedToken?.decimals) &&
      this.fromSelectedToken &&
      this.toSelectedToken &&
      // Allow the quote fetch if the error is insufficient amount, as the user might want
      // to see the routes even if he has insufficient balance
      (this.validateFromAmount.success ||
        this.validateFromAmount.errorType === 'insufficient_amount')
    )
  }

  #debounceFunctionCallsOnSameTick(funcName: string, func: Function) {
    if (this.#shouldDebounceFlags[funcName]) return
    this.#shouldDebounceFlags[funcName] = true

    // Debounce multiple calls in the same tick and only execute one of them
    setTimeout(() => {
      this.#shouldDebounceFlags[funcName] = false
      func()
    }, 0)
  }

  destroySignAccountOp() {
    if (!this.#signAccountOpController) return
    this.#signAccountOpController.destroy()
    this.#signAccountOpController = null
    this.hasProceeded = false
  }

  /**
   * Guard to ensure we only proceed with data that matches the latest active quote in `this.#updateQuoteId`.
   */
  #isQuoteIdObsoleteAfterAsyncOperation(quoteIdGuard: string) {
    return quoteIdGuard && quoteIdGuard !== this.#updateQuoteId
  }

  /**
   * This method might be called multiple times due to async updates (e.g., tokens, routes, etc.).
   * The `quoteIdGuard` acts as a guard to ensure we only proceed with data that matches
   * the latest active quote in `this.#updateQuoteId`.
   *
   * If the component re-renders or receives stale async events (e.g., an old estimation result),
   * this check prevents applying outdated data to the current form state.
   *
   * ⚠️ IMPORTANT: If you make changes here and they involve async operations,
   * make sure to check `isQuoteIdObsoleteAfterAsyncOperation` afterwards
   * to ensure you’re not acting on obsolete data.
   */
  async initSignAccountOpIfNeeded(quoteIdGuard: string) {
    // no updates if the user has committed
    if (this.formStatus === SwapAndBridgeFormStatus.Proceeded) return

    // shouldn't happen ever
    if (!this.#selectedAccount.account) return

    // again it shouldn't happen but there might be a case where the from token
    // disappears because of a strange update event. It's fine to just not
    // continue from the point forward
    if (!this.fromSelectedToken || !this.toSelectedToken || !this.toChainId) return

    if (
      this.formStatus !== SwapAndBridgeFormStatus.ReadyToEstimate &&
      this.formStatus !== SwapAndBridgeFormStatus.ReadyToSubmit
    )
      return

    const fromToken = this.fromSelectedToken as TokenResult
    const network = this.#networks.networks.find((net) => net.chainId === fromToken.chainId)

    // shouldn't happen ever
    if (!network) return

    const provider = this.#providers.providers[network.chainId.toString()]
    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      this.#selectedAccount.account.addr,
      network.chainId
    )

    if (!accountState) {
      this.updateQuoteStatus = 'INITIAL'
      this.addOrUpdateError({
        id: 'all-routes-failed',
        level: 'error',
        title: 'Missing mandatory account data. Please try again later.'
      })
      return
    }

    if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteIdGuard)) return

    const userTxn = await this.getRouteStartUserTx()

    if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteIdGuard)) return

    // if no txn is provided because of a route failure (large slippage),
    // auto select the next route and continue on
    if (!userTxn || !userTxn.success) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.markSelectedRouteAsFailed(userTxn?.title || 'Invalid quote')

      if (!this.quote?.selectedRoute?.isSelectedManually) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.onEstimationFailure(undefined)
        return
      }

      this.updateQuoteStatus = 'INITIAL'
      this.emitUpdate()
      return
    }

    // learn the token in the portfolio
    this.#portfolio.addTokensToBeLearned([this.toSelectedToken.address], BigInt(this.toChainId))

    // check if we have an accountOp in main
    const userRequestCalls =
      (
        this.#getUserRequests().find(
          (r) =>
            r.kind === 'calls' &&
            r.id === `${this.#selectedAccount.account!.addr}-${network.chainId}`
        ) as CallsUserRequest
      )?.signAccountOp.accountOp.calls || []

    const swapOrBridgeCalls = await getSwapAndBridgeCalls(
      userTxn,
      this.#selectedAccount.account,
      provider,
      accountState
    )

    if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteIdGuard)) return

    const isBridge = this.fromChainId && this.toChainId && this.fromChainId !== this.toChainId
    const calls = !isBridge ? [...userRequestCalls, ...swapOrBridgeCalls] : [...swapOrBridgeCalls]

    if (this.#signAccountOpController) {
      // if the chain id has changed, we need to destroy the sign account op
      if (
        this.#signAccountOpController.accountOp.meta &&
        this.#signAccountOpController.accountOp.meta.swapTxn &&
        this.#signAccountOpController.accountOp.meta.swapTxn.chainId !== userTxn.chainId
      ) {
        this.destroySignAccountOp()
      } else {
        // add the real swapTxn
        this.#signAccountOpController.update({
          accountOpData: {
            calls,
            meta: {
              ...(this.#signAccountOpController.accountOp.meta || {}),
              swapTxn: userTxn,
              fromQuoteId: quoteIdGuard
            }
          }
        })
        return
      }
    }

    const baseAcc = getBaseAccount(
      this.#selectedAccount.account,
      accountState,
      this.#keystore.getAccountKeys(this.#selectedAccount.account),
      network
    )
    const accountOp = {
      accountAddr: this.#selectedAccount.account.addr,
      chainId: network.chainId,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      nonce: accountState.nonce,
      signature: null,
      calls,
      flags: {
        hideActivityBanner: this.fromSelectedToken.chainId !== BigInt(this.toSelectedToken.chainId)
      },
      meta: {
        swapTxn: userTxn,
        paymasterService: getAmbirePaymasterService(baseAcc, this.#relayerUrl),
        fromQuoteId: quoteIdGuard
      }
    }

    this.#signAccountOpController = new SignAccountOpController({
      type: 'one-click-swap-and-bridge',
      callRelayer: this.#callRelayer,
      accounts: this.#accounts,
      networks: this.#networks,
      keystore: this.#keystore,
      portfolio: this.#portfolio,
      externalSignerControllers: this.#externalSignerControllers,
      activity: this.#activity,
      account: this.#selectedAccount.account,
      network,
      provider: this.#providers.providers[network.chainId.toString()],
      phishing: this.#phishing,
      fromRequestId: randomId(), // the account op and the request are fabricated,
      accountOp,
      isSignRequestStillActive: (): boolean => !!this.#signAccountOpController,
      shouldSimulate: false,
      onBroadcastSuccess: async (props) => {
        this.#portfolio
          .simulateAccountOp(props.accountOp)
          .then(() => {
            this.#portfolio.markSimulationAsBroadcasted(accountOp.accountAddr, accountOp.chainId)
          })
          .catch((e) => {
            this.emitError({
              level: 'silent',
              message: 'swap&bridge simulation failed',
              error: e
            })
          })

        await this.#onBroadcastSuccess(props)
      },
      onBroadcastFailed: this.#onBroadcastFailed
    })

    this.emitUpdate()

    this.#signAccountOpController.onUpdate(() => {
      this.emitUpdate()

      if (this.#signAccountOpController?.broadcastStatus === 'SUCCESS') {
        // Reset the form on the next tick so the FE receives the final
        // signAccountOpController update before resetForm destroys it
        setTimeout(() => {
          this.resetForm()
        }, 0)
      }
    }, 'swap-and-bridge')

    this.#signAccountOpController.onError((error) => {
      // Need to clean the pending results for THIS signAccountOpController
      // specifically. NOT the one from the getter (this.signAccountOpController)
      // that is ALWAYS up-to-date with the current quote and the current form state.
      // Due to the async nature, it might not exist - an issue caught by our crash reporting.
      if (this.#signAccountOpController)
        this.#portfolio.overrideSimulationResults(this.#signAccountOpController.accountOp)

      this.emitError(error)
    })
    // if the estimation emits an error, handle it
    this.#signAccountOpController.estimation.onUpdate(() => {
      if (
        this.#signAccountOpController?.accountOp.meta?.swapTxn?.activeRouteId &&
        this.#signAccountOpController.estimation.status === EstimationStatus.Error
      ) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.markSelectedRouteAsFailed(
          this.#signAccountOpController.estimation.error?.message || 'Invalid quote'
        )

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.onEstimationFailure(this.#signAccountOpController.accountOp.meta.swapTxn.activeRouteId)
      }
    })
  }

  setUserProceeded(hasProceeded: boolean) {
    this.hasProceeded = hasProceeded

    this.emitUpdate()
  }

  get swapSignErrors(): SignAccountOpError[] {
    const errors: SignAccountOpError[] = []
    const isBridge = this.fromChainId && this.toChainId && this.fromChainId !== this.toChainId
    const fromSelectedTokenWithUpToDateAmount = this.#getFromSelectedTokenInPortfolio()

    if (
      isBridge &&
      fromSelectedTokenWithUpToDateAmount &&
      fromSelectedTokenWithUpToDateAmount.amountPostSimulation &&
      fromSelectedTokenWithUpToDateAmount.amount !==
        fromSelectedTokenWithUpToDateAmount.amountPostSimulation
    ) {
      errors.push({
        title: `${fromSelectedTokenWithUpToDateAmount.symbol} detected in batch. Please complete the batch before bridging`
      })
    }

    // Check if there are any errors from the main SignAccountOp controller
    // This prevents proceeding with a swap/bridge if there are estimation errors
    // in the pending batch of transactions
    if (
      this.#isCurrentSignAccountOpThrowingAnEstimationError &&
      this.#isCurrentSignAccountOpThrowingAnEstimationError(this.fromChainId, this.toChainId)
    ) {
      errors.push({
        title: 'Error detected in the pending batch. Please review it before proceeding'
      })
    }

    // if we're bridging to ethereum, make the min from amount 10 usd
    if (
      isBridge &&
      this.toChainId === 1 &&
      this.fromAmountInFiat &&
      Number(this.fromAmountInFiat) < 10
    ) {
      errors.push({
        title: 'Min amount for bridging to Ethereum is $10'
      })
    }

    return errors
  }

  get banners() {
    if (!this.#selectedAccount.account) return []

    const activeRoutesForSelectedAccount = getActiveRoutesForAccount(
      this.#selectedAccount.account.addr,
      this.activeRoutes
    )
    const callsUserRequests = this.#getVisibleUserRequests().filter(
      ({ kind }) => kind === 'calls'
    ) as CallsUserRequest[]

    // Swap banners aren't generated because swaps are completed instantly,
    // thus the activity banner on broadcast is sufficient
    return getBridgeBanners(activeRoutesForSelectedAccount, callsUserRequests)
  }

  get #shouldAutoUpdateQuote() {
    return (
      this.formStatus === SwapAndBridgeFormStatus.ReadyToSubmit &&
      !this.hasProceeded &&
      this.quote &&
      !this.quote.selectedRoute?.disabled &&
      !this.quote.selectedRoute?.isSelectedManually
    )
  }

  async continuouslyUpdateQuote() {
    if (!this.#shouldAutoUpdateQuote) {
      this.updateQuoteInterval.stop()
      return
    }

    await this.updateQuote({
      skipPreviousQuoteRemoval: true,
      skipQuoteUpdateOnSameValues: false,
      skipStatusUpdate: false
    })
  }

  #getActiveRoutesInProgressSessionId() {
    if (!this.activeRoutesInProgress.length) return undefined

    return this.activeRoutesInProgress
      .map((r) => r.activeRouteId)
      .sort()
      .join('|')
  }

  async continuouslyUpdateActiveRoutes() {
    if (
      this.#continuouslyUpdateActiveRoutesPromise &&
      this.#continuouslyUpdateActiveRoutesSessionId === this.#getActiveRoutesInProgressSessionId()
    ) {
      await this.#continuouslyUpdateActiveRoutesPromise
      return
    }

    this.#continuouslyUpdateActiveRoutesPromise = this.#continuouslyUpdateActiveRoutes().finally(
      () => {
        this.#continuouslyUpdateActiveRoutesPromise = undefined
      }
    )

    await this.#continuouslyUpdateActiveRoutesPromise
  }

  async #continuouslyUpdateActiveRoutes() {
    this.#continuouslyUpdateActiveRoutesSessionId = this.#getActiveRoutesInProgressSessionId()

    if (!this.activeRoutesInProgress.length) {
      this.#updateActiveRoutesInterval.stop()
      return
    }

    await this.checkForActiveRoutesStatusUpdate()

    if (!this.activeRoutesInProgress.length) {
      this.#updateActiveRoutesInterval.stop()
      return
    }

    // coming here means the bridge should complete any second now
    // so start with BRIDGE_STATUS_INTERVAL
    // upon status pending, increase by BRIDGE_STATUS_INTERVAL until the ceiling is hit
    const ceiling = 60000
    const minServiceTime = getActiveRoutesLowestServiceTime(this.activeRoutesInProgress)
    const startTimeout =
      minServiceTime === this.#updateActiveRoutesInterval.currentTimeout
        ? BRIDGE_STATUS_INTERVAL
        : this.#updateActiveRoutesInterval.currentTimeout + BRIDGE_STATUS_INTERVAL

    this.#updateActiveRoutesInterval.updateTimeout({
      timeout: startTimeout < ceiling ? startTimeout : ceiling
    })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      toTokenShortList: this.toTokenShortList,
      updateToTokenListStatus: this.updateToTokenListStatus,
      maxFromAmount: this.maxFromAmount,
      validateFromAmount: this.validateFromAmount,
      isFormEmpty: this.isFormEmpty,
      formStatus: this.formStatus,
      activeRoutesInProgress: this.activeRoutesInProgress,
      activeRoutes: this.activeRoutes,
      isHealthy: this.isHealthy,
      shouldEnableRoutesSelection: this.shouldEnableRoutesSelection,
      supportedChainIds: this.supportedChainIds,
      swapSignErrors: this.swapSignErrors,
      signAccountOpController: this.signAccountOpController,
      banners: this.banners
    }
  }
}
