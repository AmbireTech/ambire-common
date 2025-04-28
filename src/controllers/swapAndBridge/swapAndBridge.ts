import { formatUnits, isAddress, parseUnits } from 'ethers'
import { v4 as uuidv4 } from 'uuid'

import EmittableError from '../../classes/EmittableError'
import SwapAndBridgeError from '../../classes/SwapAndBridgeError'
import { ExternalSignerControllers } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
/* eslint-disable no-await-in-loop */
import { SignAccountOpError } from '../../interfaces/signAccountOp'
import {
  CachedSupportedChains,
  CachedTokenListKey,
  CachedToTokenLists,
  FromToken,
  SocketApiBridgeStep,
  SocketAPIBridgeUserTx,
  SocketRouteStatus,
  SwapAndBridgeActiveRoute,
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeToToken,
  SwapAndBridgeUserTx
} from '../../interfaces/swapAndBridge'
import { UserRequest } from '../../interfaces/userRequest'
import { isBasicAccount } from '../../libs/account/account'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
import { getBridgeBanners } from '../../libs/banners/banners'
import { randomId } from '../../libs/humanizer/utils'
import { batchCallsFromUserRequests } from '../../libs/main/main'
import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import {
  addCustomTokensIfNeeded,
  convertPortfolioTokenToSwapAndBridgeToToken,
  getActiveRoutesForAccount,
  getIsBridgeTxn,
  getIsTokenEligibleForSwapAndBridge,
  getSwapAndBridgeCalls,
  sortPortfolioTokenList,
  sortTokenListResponse
} from '../../libs/swapAndBridge/swapAndBridge'
import { getHumanReadableSwapAndBridgeError } from '../../libs/swapAndBridge/swapAndBridgeErrorHumanizer'
import { getSanitizedAmount } from '../../libs/transfer/amount'
import { LiFiAPI } from '../../services/lifi/api'
import { normalizeIncomingSocketToken, SocketAPI } from '../../services/socket/api'
import { ZERO_ADDRESS } from '../../services/socket/constants'
import { validateSendTransferAmount } from '../../services/validations/validate'
import formatDecimals from '../../utils/formatDecimals/formatDecimals'
import { convertTokenPriceToBigInt } from '../../utils/numbers/formatters'
import wait from '../../utils/wait'
import { AccountsController } from '../accounts/accounts'
import { AccountOpAction, ActionsController } from '../actions/actions'
import { ActivityController } from '../activity/activity'
import { EstimationStatus } from '../estimation/types'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { noStateUpdateStatuses, SignAccountOpController } from '../signAccountOp/signAccountOp'
import { StorageController } from '../storage/storage'

type SwapAndBridgeErrorType = {
  id: 'to-token-list-fetch-failed' // ...
  title: string
  text?: string
  level: 'error' | 'warning'
}

const HARD_CODED_CURRENCY = 'usd'

const CONVERSION_PRECISION = 16
const CONVERSION_PRECISION_POW = BigInt(10 ** CONVERSION_PRECISION)

const NETWORK_MISMATCH_MESSAGE =
  'Swap & Bridge network configuration mismatch. Please try again or contact Ambire support.'

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

const PROTOCOLS_WITH_CONTRACT_FEE_IN_NATIVE = [
  'stargate',
  'stargate-v2',
  'arbitrum-bridge',
  'zksync-native'
]

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
export class SwapAndBridgeController extends EventEmitter {
  #selectedAccount: SelectedAccountController

  #networks: NetworksController

  #actions: ActionsController

  #activity: ActivityController

  #invite: InviteController

  #storage: StorageController

  #serviceProviderAPI: SocketAPI | LiFiAPI

  #activeRoutes: SwapAndBridgeActiveRoute[] = []

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  updateQuoteStatus: 'INITIAL' | 'LOADING' = 'INITIAL'

  #updateToTokenListThrottle: {
    time: number
    throttled: boolean
    shouldReset: boolean
    addressToSelect?: string
  } = {
    time: 0,
    shouldReset: true,
    throttled: false
  }

  #updateQuoteId?: string

  #updateQuoteTimeout?: ReturnType<typeof setTimeout>

  updateToTokenListStatus: 'INITIAL' | 'LOADING' = 'INITIAL'

  sessionIds: string[] = []

  fromChainId: number | null = 1

  fromSelectedToken: FromToken | null = null

  fromAmount: string = ''

  fromAmountInFiat: string = ''

  fromAmountFieldMode: 'fiat' | 'token' = 'token'

  toChainId: number | null = 1

  toSelectedToken: SwapAndBridgeToToken | null = null

  quote: SwapAndBridgeQuote | null = null

  quoteRoutesStatuses: { [key: string]: { status: string } } = {}

  portfolioTokenList: FromToken[] = []

  isTokenListLoading: boolean = false

  errors: SwapAndBridgeErrorType[] = []

  /**
   * Needed to efficiently manage and cache token lists for different chain
   * combinations (fromChainId and toChainId) without having to fetch them
   * repeatedly from the API. Moreover, this way tokens added to a list by
   * address are also cached for sometime.
   */
  #cachedToTokenLists: CachedToTokenLists = {}

  #toTokenList: SwapAndBridgeToToken[] = []

  /**
   * Similar to the `#cachedToTokenLists`, this helps in avoiding repeated API
   * calls to fetch the supported chains from our service provider.
   */
  #cachedSupportedChains: CachedSupportedChains = { lastFetched: 0, data: [] }

  routePriority: 'output' | 'time' = 'output'

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  #shouldDebounceFlags: { [key: string]: boolean } = {}

  #accounts: AccountsController

  #keystore: KeystoreController

  #portfolio: PortfolioController

  #externalSignerControllers: ExternalSignerControllers

  #providers: ProvidersController

  signAccountOpController: SignAccountOpController | null = null

  #portfolioUpdate: Function

  hasProceeded: boolean = false

  /**
   * Describes whether quote refetch should happen at a given interval.
   * We forbid it:
   * - when the user has chosen a custom route by himself
   */
  isAutoSelectRouteDisabled: boolean = false

  #isReestimating: boolean = false

  #userRequests: UserRequest[]

  constructor({
    accounts,
    keystore,
    portfolio,
    externalSignerControllers,
    providers,
    selectedAccount,
    networks,
    activity,
    serviceProviderAPI,
    storage,
    actions,
    invite,
    portfolioUpdate,
    userRequests = []
  }: {
    accounts: AccountsController
    keystore: KeystoreController
    portfolio: PortfolioController
    externalSignerControllers: ExternalSignerControllers
    providers: ProvidersController
    selectedAccount: SelectedAccountController
    networks: NetworksController
    activity: ActivityController
    serviceProviderAPI: SocketAPI | LiFiAPI
    storage: StorageController
    actions: ActionsController
    invite: InviteController
    userRequests: UserRequest[]
    portfolioUpdate?: Function
  }) {
    super()
    this.#accounts = accounts
    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#externalSignerControllers = externalSignerControllers
    this.#providers = providers
    this.#portfolioUpdate = portfolioUpdate || (() => {})
    this.#selectedAccount = selectedAccount
    this.#networks = networks
    this.#activity = activity
    this.#serviceProviderAPI = serviceProviderAPI
    this.#storage = storage
    this.#actions = actions
    this.#invite = invite
    this.#userRequests = userRequests

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#initialLoadPromise = this.#load()
  }

  #emitUpdateIfNeeded() {
    const shouldSkipUpdate =
      // No need to emit emit updates if there are no active sessions
      !this.sessionIds.length &&
      // but ALSO there are no active routes (otherwise, banners need the updates)
      !this.activeRoutes.length
    if (shouldSkipUpdate) return

    super.emitUpdate()
  }

  async #load() {
    await this.#networks.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise

    this.activeRoutes = await this.#storage.get('swapAndBridgeActiveRoutes', [])
    // Service provider may have changed since the last time the user interacted
    // with the Swap & Bridge. So strip out cached active routes that were NOT
    // made by the current service provider, because they are NOT compatible.
    //
    // also, just in case protection: filter out ready routes as we don't have
    // retry mechanism or follow up transaction handling anymore. Which means
    // ready routes in the storage are just leftover routes
    this.activeRoutes = this.activeRoutes.filter(
      (r) => r.serviceProviderId === this.#serviceProviderAPI.id && r.routeStatus !== 'ready'
    )

    this.#selectedAccount.onUpdate(() => {
      this.#debounceFunctionCallsOnSameTick('updateFormOnSelectedAccountUpdate', () => {
        if (this.#selectedAccount.portfolio.isReadyToVisualize) {
          this.isTokenListLoading = false
          this.updatePortfolioTokenList(this.#selectedAccount.portfolio.tokens)
          // To token list includes selected account portfolio tokens, it should get an update too
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.updateToTokenList(false)
        }
      })
    })
    this.#emitUpdateIfNeeded()
  }

  // The token in portfolio is the source of truth for the amount, it updates
  // on every balance (pending or anything) change.
  #getFromSelectedTokenInPortfolio = () =>
    this.portfolioTokenList.find(
      (t) =>
        t.address === this.fromSelectedToken?.address &&
        t.chainId === this.fromSelectedToken?.chainId &&
        getIsTokenEligibleForSwapAndBridge(t)
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

  get formStatus() {
    if (this.hasProceeded) return SwapAndBridgeFormStatus.Proceeded

    if (this.isFormEmpty) return SwapAndBridgeFormStatus.Empty
    if (this.validateFromAmount.message) return SwapAndBridgeFormStatus.Invalid
    if (this.updateQuoteStatus === 'LOADING' && !this.quote)
      return SwapAndBridgeFormStatus.FetchingRoutes
    if (!this.quote?.routes.filter((route) => !route.hasFailed).length)
      return SwapAndBridgeFormStatus.NoRoutesFound

    if (this.quote?.selectedRoute?.errorMessage) return SwapAndBridgeFormStatus.InvalidRouteSelected

    if (
      !this.signAccountOpController ||
      this.signAccountOpController.estimation.status !== EstimationStatus.Success
    )
      return SwapAndBridgeFormStatus.ReadyToEstimate

    return SwapAndBridgeFormStatus.ReadyToSubmit
  }

  get validateFromAmount() {
    if (!this.fromSelectedToken) return { success: false, message: '' }

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

    return validateSendTransferAmount(
      this.fromAmount,
      Number(this.maxFromAmount),
      Number(this.maxFromAmountInFiat),
      this.fromSelectedToken
    )
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
  }

  get shouldEnableRoutesSelection() {
    return (
      !!this.quote &&
      !!this.quote.routes &&
      this.quote.routes.length > 1 &&
      this.updateQuoteStatus !== 'LOADING'
    )
  }

  async initForm(sessionId: string) {
    await this.#initialLoadPromise

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
    this.updatePortfolioTokenList(this.#selectedAccount.portfolio.tokens)
    this.isTokenListLoading = false
    // Do not await on purpose as it's not critical for the controller state to be ready
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#fetchSupportedChainsIfNeeded()
    this.#emitUpdateIfNeeded()
  }

  get isHealthy() {
    return this.#serviceProviderAPI.isHealthy
  }

  #fetchSupportedChainsIfNeeded = async () => {
    const shouldNotReFetchSupportedChains =
      this.#cachedSupportedChains.data.length &&
      Date.now() - this.#cachedSupportedChains.lastFetched < SUPPORTED_CHAINS_CACHE_THRESHOLD
    if (shouldNotReFetchSupportedChains) return

    try {
      const supportedChains = await this.#serviceProviderAPI.getSupportedChains()

      this.#cachedSupportedChains = { lastFetched: Date.now(), data: supportedChains }
      this.#emitUpdateIfNeeded()
    } catch (error: any) {
      // Fail silently, as this is not a critical feature, Swap & Bridge is still usable
      this.emitError({ error, level: 'silent', message: error?.message })
    }
  }

  get supportedChainIds(): Network['chainId'][] {
    return this.#cachedSupportedChains.data.map((c) => BigInt(c.chainId))
  }

  get #toTokenListKey(): CachedTokenListKey | null {
    if (this.fromChainId === null || this.toChainId === null) return null

    return `from-${this.fromChainId}-to-${this.toChainId}`
  }

  unloadScreen(sessionId: string, forceUnload?: boolean) {
    const isFormDirty = !!this.fromAmount || !!this.toSelectedToken
    const signAccountOpCtrlStatus = this.signAccountOpController?.status?.type
    const isSigningOrBroadcasting =
      signAccountOpCtrlStatus && noStateUpdateStatuses.includes(signAccountOpCtrlStatus)
    const shouldPersistState =
      ((isFormDirty && sessionId === 'popup') || isSigningOrBroadcasting) && !forceUnload

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

  updateForm(
    props: {
      fromAmount?: string
      fromAmountInFiat?: string
      fromAmountFieldMode?: 'fiat' | 'token'
      fromSelectedToken?: TokenResult | null
      toChainId?: bigint | number
      toSelectedToken?: SwapAndBridgeToToken | null
      routePriority?: 'output' | 'time'
    },
    emitUpdate: boolean = true
  ) {
    const {
      fromAmount,
      fromAmountInFiat,
      fromAmountFieldMode,
      fromSelectedToken,
      toChainId,
      toSelectedToken,
      routePriority
    } = props

    // fromAmountFieldMode must be set before fromAmount so it
    // works correctly when both are set at the same time
    if (fromAmountFieldMode) {
      this.fromAmountFieldMode = fromAmountFieldMode
    }

    if (fromAmount !== undefined) {
      const fromAmountFormatted = fromAmount.indexOf('.') === 0 ? `0${fromAmount}` : fromAmount
      this.fromAmount = fromAmount
      ;(() => {
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
          const amountInFiatDecimals = fromAmount.split('.')[1]?.length || 0
          const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

          // Convert the numbers to big int
          const amountInFiatBigInt = parseUnits(fromAmountFormatted, amountInFiatDecimals)

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

          const sanitizedFieldValue = getSanitizedAmount(
            fromAmountFormatted,
            this.fromSelectedToken.decimals
          )
          // Convert the field value to big int
          const formattedAmount = parseUnits(sanitizedFieldValue, this.fromSelectedToken.decimals)

          if (!formattedAmount) return

          const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

          this.fromAmountInFiat = formatUnits(
            formattedAmount * tokenPriceBigInt,
            // Shift the decimal point by the number of decimals in the token price
            this.fromSelectedToken.decimals + tokenPriceDecimals
          )
        }
      })()
    }

    if (fromAmountInFiat !== undefined) {
      this.fromAmountInFiat = fromAmountInFiat
    }

    if (fromSelectedToken) {
      const isFromNetworkChanged = this.fromSelectedToken?.chainId !== fromSelectedToken?.chainId
      if (isFromNetworkChanged) {
        const network = this.#networks.networks.find((n) => n.chainId === fromSelectedToken.chainId)
        if (network) {
          this.fromChainId = Number(network.chainId)
          // Don't update the selected token programmatically if the user
          // has selected it manually
          if (!this.toSelectedToken) {
            // defaults to swap after network change (should keep fromChainId and toChainId in sync after fromChainId update)
            this.toChainId = Number(network.chainId)
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.updateToTokenList(true)
          }
        }
      }

      const shouldResetFromTokenAmount =
        isFromNetworkChanged || this.fromSelectedToken?.address !== fromSelectedToken.address
      if (shouldResetFromTokenAmount) {
        this.fromAmount = ''
        this.fromAmountInFiat = ''
        this.fromAmountFieldMode = 'token'
      }

      // Always update to reflect portfolio amount (or other props) changes
      this.fromSelectedToken = fromSelectedToken
    }

    if (toChainId) {
      if (this.toChainId !== Number(toChainId)) {
        this.toChainId = Number(toChainId)
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.updateToTokenList(true)
      }
    }

    if (toSelectedToken) {
      this.toSelectedToken = toSelectedToken
    }

    if (routePriority) {
      this.routePriority = routePriority
      if (this.quote) {
        this.quote = null
        this.quoteRoutesStatuses = {}
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.updateQuote()

    if (emitUpdate) this.#emitUpdateIfNeeded()
  }

  resetForm(shouldEmit?: boolean) {
    // Preserve key form states instead of resetting the whole form to enhance UX and reduce confusion.
    // After form submission, maintain the state for fromSelectedToken, fromChainId, and toChainId,
    // while resetting all other state related to the form.
    this.fromAmount = ''
    this.fromAmountInFiat = ''
    this.fromAmountFieldMode = 'token'
    this.toSelectedToken = null
    this.quote = null
    this.updateQuoteStatus = 'INITIAL'
    this.quoteRoutesStatuses = {}
    this.destroySignAccountOp()
    this.hasProceeded = false
    this.isAutoSelectRouteDisabled = false

    if (shouldEmit) this.#emitUpdateIfNeeded()
  }

  reset(shouldEmit?: boolean) {
    this.resetForm()
    this.fromChainId = 1
    this.fromSelectedToken = null
    this.toChainId = 1
    this.portfolioTokenList = []
    this.#toTokenList = []
    this.errors = []

    if (shouldEmit) this.#emitUpdateIfNeeded()
  }

  updatePortfolioTokenList(nextPortfolioTokenList: TokenResult[]) {
    const tokens = nextPortfolioTokenList.filter(getIsTokenEligibleForSwapAndBridge)
    this.portfolioTokenList = sortPortfolioTokenList(
      // Filtering out hidden tokens here means: 1) They won't be displayed in
      // the "From" token list (`this.portfolioTokenList`) and 2) They won't be
      // added to the "Receive" token list as additional tokens from portfolio,
      // BUT 3) They will appear in the "Receive" if they are present in service
      // provider's to token list. This is the desired behavior.
      tokens.filter((t) => !t.flags.isHidden)
    )

    const fromSelectedTokenInNextPortfolio = this.portfolioTokenList.find(
      (t) =>
        t.address === this.fromSelectedToken?.address &&
        t.chainId === this.fromSelectedToken?.chainId
    )

    const shouldUpdateFromSelectedToken =
      !this.fromSelectedToken || // initial (default) state
      // May happen if selected account gets changed or the token gets send away in the meantime
      !fromSelectedTokenInNextPortfolio ||
      // May happen if user receives or sends the token in the meantime
      fromSelectedTokenInNextPortfolio.amount !== this.fromSelectedToken?.amount

    // If the token is not in the portfolio because it was a "to" token
    // and the user has switched the "from" and "to" tokens we should not
    // update the selected token
    if (!this.fromSelectedToken?.isSwitchedZeroToken && shouldUpdateFromSelectedToken) {
      this.updateForm({
        fromSelectedToken: fromSelectedTokenInNextPortfolio || this.portfolioTokenList[0] || null
      })
      return
    }
    if (this.fromSelectedToken?.isSwitchedZeroToken) {
      this.#addFromTokenToPortfolioListIfNeeded()
    }

    this.#emitUpdateIfNeeded()
  }

  async updateToTokenList(shouldReset: boolean, addressToSelect?: string) {
    const now = Date.now()
    const timeSinceLastCall = now - this.#updateToTokenListThrottle.time
    if (timeSinceLastCall <= 500) {
      this.#updateToTokenListThrottle.shouldReset = shouldReset
      this.#updateToTokenListThrottle.addressToSelect = addressToSelect

      if (!this.#updateToTokenListThrottle.throttled) {
        this.#updateToTokenListThrottle.throttled = true
        await wait(500 - timeSinceLastCall)
        this.#updateToTokenListThrottle.throttled = false
        await this.updateToTokenList(
          this.#updateToTokenListThrottle.shouldReset,
          this.#updateToTokenListThrottle.addressToSelect
        )
      }
      return
    }
    this.updateToTokenListStatus = 'LOADING'
    this.#updateToTokenListThrottle.time = now
    this.removeError('to-token-list-fetch-failed', false)
    if (!this.fromChainId || !this.toChainId) return

    if (shouldReset) {
      this.#toTokenList = []
      this.toSelectedToken = null
      this.#emitUpdateIfNeeded()
    }

    const toTokenListInCache =
      this.#toTokenListKey && this.#cachedToTokenLists[this.#toTokenListKey]
    let toTokenList: SwapAndBridgeToToken[] = toTokenListInCache?.data || []
    const shouldFetchTokenList =
      !toTokenList.length ||
      now - (toTokenListInCache?.lastFetched || 0) >= TO_TOKEN_LIST_CACHE_THRESHOLD
    if (shouldFetchTokenList) {
      try {
        toTokenList = await this.#serviceProviderAPI.getToTokenList({
          fromChainId: this.fromChainId,
          toChainId: this.toChainId
        })
        // Cache the latest token list
        if (this.#toTokenListKey) {
          this.#cachedToTokenLists[this.#toTokenListKey] = {
            lastFetched: now,
            data: toTokenList
          }
        }
      } catch (error: any) {
        // Display an error only if there is no cached data
        if (!toTokenList.length) {
          toTokenList = addCustomTokensIfNeeded({ chainId: this.toChainId, tokens: toTokenList })
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

    const toTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === this.toChainId)
    // should never happen
    if (!toTokenNetwork) throw new SwapAndBridgeError(NETWORK_MISMATCH_MESSAGE)

    const additionalTokensFromPortfolio = this.portfolioTokenList
      .filter((t) => t.chainId === toTokenNetwork.chainId)
      .filter((token) => !toTokenList.some((t) => t.address === token.address))
      .map((t) => convertPortfolioTokenToSwapAndBridgeToToken(t, Number(toTokenNetwork.chainId)))

    this.#toTokenList = sortTokenListResponse(
      [...toTokenList, ...additionalTokensFromPortfolio],
      this.portfolioTokenList.filter((t) => t.chainId === toTokenNetwork.chainId)
    )

    if (!this.toSelectedToken) {
      if (addressToSelect) {
        const token = this.#toTokenList.find((t) => t.address === addressToSelect)
        if (token) {
          this.updateForm({ toSelectedToken: token })
          this.updateToTokenListStatus = 'INITIAL'
          this.#emitUpdateIfNeeded()
          return
        }
      }
    }

    this.updateToTokenListStatus = 'INITIAL'
    this.#emitUpdateIfNeeded()
  }

  get toTokenList(): SwapAndBridgeToToken[] {
    const isSwapping = this.fromChainId === this.toChainId
    if (isSwapping) {
      // Swaps between same "from" and "to" tokens are not feasible, filter them out
      return this.#toTokenList.filter((t) => t.address !== this.fromSelectedToken?.address)
    }

    return this.#toTokenList
  }

  async #addToTokenByAddress(address: string) {
    if (!this.toChainId) return // should never happen
    if (!isAddress(address)) return // no need to attempt with invalid addresses

    const isAlreadyInTheList = this.#toTokenList.some((t) => t.address === address)
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

    if (this.#toTokenListKey)
      // Cache for sometime the tokens added by address
      this.#cachedToTokenLists[this.#toTokenListKey]?.data.push(token)

    const toTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === this.toChainId)
    // should never happen
    if (!toTokenNetwork) {
      const error = new SwapAndBridgeError(NETWORK_MISMATCH_MESSAGE)
      throw new EmittableError({ error, level: 'minor', message: error?.message })
    }

    const nextTokenList: SwapAndBridgeToToken[] = [...this.#toTokenList, token]

    this.#toTokenList = sortTokenListResponse(
      nextTokenList,
      this.portfolioTokenList.filter((t) => t.chainId === toTokenNetwork.chainId)
    )

    this.#emitUpdateIfNeeded()
    return token
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

    if (isAlreadyInTheList || !this.fromSelectedToken.isSwitchedZeroToken) return

    this.portfolioTokenList = [...this.portfolioTokenList, this.fromSelectedToken]
  }

  addToTokenByAddress = async (address: string) =>
    this.withStatus('addToTokenByAddress', () => this.#addToTokenByAddress(address), true)

  async switchFromAndToTokens() {
    const currentFromSelectedToken = { ...this.fromSelectedToken }

    if (!this.toSelectedToken) {
      this.fromSelectedToken = null
    } else if (this.toChainId) {
      const toSelectedTokenNetwork = this.#networks.networks.find(
        (n) => Number(n.chainId) === this.toChainId
      )!
      const tokenInPortfolio = this.portfolioTokenList.find(
        (token: TokenResult) =>
          token.address === this.toSelectedToken?.address &&
          token.chainId === toSelectedTokenNetwork.chainId
      )

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
        priceIn: [],
        isSwitchedZeroToken: true
      }
      this.#addFromTokenToPortfolioListIfNeeded()
    }
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
    this.updateForm(
      {
        fromAmount,
        fromAmountFieldMode: 'token'
      },
      false
    )
    // this.fromAmount = this.quote?.selectedRoute?.toAmount || ''
    ;[this.fromChainId, this.toChainId] = [this.toChainId, this.fromChainId]
    this.emitUpdate()
    await this.updateToTokenList(true, currentFromSelectedToken.address)
  }

  async updateQuote(
    options: {
      skipQuoteUpdateOnSameValues?: boolean
      skipPreviousQuoteRemoval?: boolean
      skipStatusUpdate?: boolean
    } = {
      skipQuoteUpdateOnSameValues: true,
      skipPreviousQuoteRemoval: false,
      skipStatusUpdate: false
    }
  ) {
    // no updates if the user has commited
    if (this.formStatus === SwapAndBridgeFormStatus.Proceeded || this.isAutoSelectRouteDisabled)
      return

    const quoteId = uuidv4()
    this.#updateQuoteId = quoteId

    const updateQuoteFunction = async () => {
      if (!this.#selectedAccount.account) return
      if (!this.fromAmount) return

      const sanitizedFromAmount = getSanitizedAmount(
        this.fromAmount,
        this.fromSelectedToken!.decimals
      )

      const bigintFromAmount = parseUnits(sanitizedFromAmount, this.fromSelectedToken!.decimals)

      if (this.quote) {
        const isFromAmountSame =
          this.quote.selectedRoute?.fromAmount === bigintFromAmount.toString()
        const isFromNetworkSame = this.quote.fromChainId === this.fromChainId
        const isFromAddressSame = this.quote.fromAsset.address === this.fromSelectedToken!.address
        const isToNetworkSame = this.quote.toChainId === this.toChainId
        const isToAddressSame = this.quote.toAsset.address === this.toSelectedToken!.address

        if (
          options.skipQuoteUpdateOnSameValues &&
          isFromAmountSame &&
          isFromNetworkSame &&
          isFromAddressSame &&
          isToNetworkSame &&
          isToAddressSame
        ) {
          return
        }
      }
      if (!options.skipPreviousQuoteRemoval) {
        if (this.quote) {
          this.quote = null
          this.updateQuoteStatus = 'LOADING'
        }
        this.quoteRoutesStatuses = {}
        this.#emitUpdateIfNeeded()
      }

      try {
        const quoteResult = await this.#serviceProviderAPI.quote({
          fromAsset: this.fromSelectedToken,
          fromChainId: this.fromChainId!,
          fromTokenAddress: this.fromSelectedToken!.address,
          toAsset: this.toSelectedToken,
          toChainId: this.toChainId!,
          toTokenAddress: this.toSelectedToken!.address,
          fromAmount: bigintFromAmount,
          userAddress: this.#selectedAccount.account.addr,
          isSmartAccount: !isBasicAccount(
            this.#selectedAccount.account,
            await this.#accounts.getOrFetchAccountOnChainState(
              this.#selectedAccount.account.addr,
              BigInt(this.toChainId!)
            )
          ),
          sort: this.routePriority,
          isOG: this.#invite.isOG
        })

        if (quoteId !== this.#updateQuoteId) return
        // no updates if the user has commited
        if (this.formStatus === SwapAndBridgeFormStatus.Proceeded || this.isAutoSelectRouteDisabled)
          return

        if (
          this.#getIsFormValidToFetchQuote() &&
          quoteResult &&
          quoteResult?.routes?.[0] &&
          quoteResult.fromChainId === this.fromChainId &&
          quoteResult.toChainId === this.toChainId &&
          quoteResult.toAsset.address === this.toSelectedToken?.address
        ) {
          let routeToSelect
          let routeToSelectSteps
          let routes = quoteResult.routes || []

          try {
            if (this.#serviceProviderAPI.id === 'socket') {
              routes = routes.map((route) => {
                if (!route.userTxs) return route

                const bridgeTx = route.userTxs.find((tx) => getIsBridgeTxn(tx.userTxType)) as
                  | SwapAndBridgeUserTx
                  | undefined

                if (!bridgeTx) return route

                const bridgeStep = (bridgeTx as unknown as SocketAPIBridgeUserTx).steps.find(
                  (s) => s.type === 'bridge'
                ) as SocketApiBridgeStep | undefined

                if (!bridgeStep) return route
                if (bridgeStep.protocolFees.amount === '0') return route

                const normalizedProtocolFeeToken = normalizeIncomingSocketToken(
                  bridgeStep.protocolFees.asset
                )

                const doesProtocolRequireExtraContractFeeInNative =
                  PROTOCOLS_WITH_CONTRACT_FEE_IN_NATIVE.includes(bridgeStep.protocol.name) &&
                  // When other tokens than the native ones are being bridged,
                  // Socket API takes the fee directly from the "From" amount.
                  normalizedProtocolFeeToken.address === ZERO_ADDRESS

                if (!doesProtocolRequireExtraContractFeeInNative) return route

                const protocolFeeTokenNetwork = this.#networks.networks.find(
                  (n) => Number(n.chainId) === normalizedProtocolFeeToken.chainId
                )!

                const isTokenToPayFeeWithTheSameAsFromToken =
                  this.fromSelectedToken?.address === normalizedProtocolFeeToken.address &&
                  this.fromChainId === normalizedProtocolFeeToken.chainId

                const tokenToPayFeeWith = this.portfolioTokenList.find((t) => {
                  return (
                    t.address === normalizedProtocolFeeToken.address &&
                    t.chainId === protocolFeeTokenNetwork.chainId
                  )
                })

                const protocolFeeTokenDecimals = bridgeStep.protocolFees.asset.decimals
                const portfolioTokenToPayFeeWithDecimals = tokenToPayFeeWith
                  ? tokenToPayFeeWith.decimals
                  : protocolFeeTokenDecimals
                const fromAmountNumber = Number(this.fromAmount)
                const fromAmountScaledToTokenToPayFeeWithDecimals = BigInt(
                  Math.round(fromAmountNumber * 10 ** portfolioTokenToPayFeeWithDecimals)
                )

                const tokenToPayFeeWithScaledToPortfolioTokenToPayFeeWithDecimals =
                  tokenToPayFeeWith
                    ? // Scale tokenToPayFeeWith to the same decimals as portfolioTokenToPayFeeWithDecimals
                      tokenToPayFeeWith.amount *
                      BigInt(10 ** (protocolFeeTokenDecimals - portfolioTokenToPayFeeWithDecimals))
                    : BigInt(0)

                const availableAfterSubtractionScaledToPortfolioTokenToPayFeeWithDecimals =
                  isTokenToPayFeeWithTheSameAsFromToken
                    ? tokenToPayFeeWithScaledToPortfolioTokenToPayFeeWithDecimals -
                      fromAmountScaledToTokenToPayFeeWithDecimals
                    : tokenToPayFeeWithScaledToPortfolioTokenToPayFeeWithDecimals

                const protocolFeesAmountScaledToPortfolioTokenToPayFeeWithDecimals = BigInt(
                  Math.round(
                    Number(bridgeStep.protocolFees.amount) *
                      10 ** (portfolioTokenToPayFeeWithDecimals - protocolFeeTokenDecimals)
                  )
                )
                const hasEnoughAmountToPayFee =
                  availableAfterSubtractionScaledToPortfolioTokenToPayFeeWithDecimals >=
                  protocolFeesAmountScaledToPortfolioTokenToPayFeeWithDecimals

                if (!hasEnoughAmountToPayFee) {
                  const protocolName = bridgeStep.protocol.displayName
                  const insufficientTokenSymbol = bridgeStep.protocolFees.asset.symbol
                  const insufficientTokenNetwork = protocolFeeTokenNetwork.name
                  const insufficientAssetAmount = formatUnits(
                    bridgeStep.protocolFees.amount,
                    bridgeStep.protocolFees.asset.decimals
                  )
                  const insufficientAssetAmountInUsd = formatDecimals(
                    bridgeStep.protocolFees.feesInUsd,
                    'value'
                  )

                  // Trick to show the error message on the UI, as the API doesn't handle this
                  // eslint-disable-next-line no-param-reassign
                  route.errorMessage = `Insufficient ${insufficientTokenSymbol} on ${insufficientTokenNetwork}. You need ${insufficientAssetAmount} ${insufficientTokenSymbol} (${insufficientAssetAmountInUsd}) on ${insufficientTokenNetwork} to cover the ${protocolName} protocol fee for this route.`
                }

                return route
              })
            }

            routes = routes.sort((a, b) => Number(!!a.errorMessage) - Number(!!b.errorMessage))
          } catch (error) {
            // if the filtration fails for some reason continue with the original routes
            // array without interrupting the rest of the logic
            // eslint-disable-next-line no-console
            console.error(error)
          }

          if (!routes.length) {
            this.quote = null
            return
          }

          const alreadySelectedRoute = routes.find((nextRoute) => {
            if (!this.quote) return false

            // Because we only have routes with unique bridges (bridging case)
            const selectedRouteUsedBridge = this.quote.selectedRoute?.usedBridgeNames?.[0]
            if (selectedRouteUsedBridge)
              return nextRoute.usedBridgeNames?.[0] === selectedRouteUsedBridge

            // Assuming to only have routes with unique DEXes (swapping case)
            const selectedRouteUsedDex = this.quote.selectedRoute?.usedDexName
            if (selectedRouteUsedDex) return nextRoute.usedDexName === selectedRouteUsedDex

            return false // should never happen, but just in case of bad data
          })

          if (alreadySelectedRoute) {
            routeToSelect = alreadySelectedRoute
            routeToSelectSteps = alreadySelectedRoute.steps
          } else {
            let bestRoute = routes[0]
            if (this.#serviceProviderAPI.id === 'socket') {
              bestRoute =
                this.routePriority === 'output'
                  ? routes[0] // API returns highest output first
                  : routes[routes.length - 1] // API returns fastest... last
            }
            routeToSelect = bestRoute
            routeToSelectSteps = bestRoute.steps
          }

          this.quote = {
            fromAsset: quoteResult.fromAsset,
            fromChainId: quoteResult.fromChainId,
            toAsset: quoteResult.toAsset,
            toChainId: quoteResult.toChainId,
            selectedRoute: routeToSelect,
            selectedRouteSteps: routeToSelectSteps,
            routes
          }
        }
        this.quoteRoutesStatuses = (quoteResult as any).bridgeRouteErrors || {}
        await this.initSignAccountOpIfNeeded()
      } catch (error: any) {
        const { message } = getHumanReadableSwapAndBridgeError(error)
        this.emitError({ error, level: 'major', message })
      }
    }

    if (!this.#getIsFormValidToFetchQuote()) {
      if (this.quote || this.quoteRoutesStatuses) {
        this.quote = null
        this.quoteRoutesStatuses = {}
        this.#emitUpdateIfNeeded()
      }
      return
    }

    let nextTimeout = 400 // timeout when there is no pending quote update
    if (this.#updateQuoteTimeout) {
      nextTimeout = 1000 // timeout when there is a pending quote update
      clearTimeout(this.#updateQuoteTimeout)
      this.#updateQuoteTimeout = undefined
    }

    if (!options.skipStatusUpdate && !this.quote) {
      this.updateQuoteStatus = 'LOADING'
      this.#emitUpdateIfNeeded()
    }

    this.#updateQuoteTimeout = setTimeout(async () => {
      if (!options.skipStatusUpdate && !!this.quote) {
        this.updateQuoteStatus = 'LOADING'
        this.#emitUpdateIfNeeded()
      }

      await updateQuoteFunction()

      if (quoteId !== this.#updateQuoteId) return

      this.updateQuoteStatus = 'INITIAL'
      this.#emitUpdateIfNeeded()
      clearTimeout(this.#updateQuoteTimeout)
      this.#updateQuoteTimeout = undefined
    }, nextTimeout)
  }

  async getRouteStartUserTx(shouldThrowOnError = true): Promise<SwapAndBridgeSendTxRequest | null> {
    if (
      this.formStatus !== SwapAndBridgeFormStatus.ReadyToEstimate &&
      this.formStatus !== SwapAndBridgeFormStatus.ReadyToSubmit
    )
      return null

    try {
      const routeResult = await this.#serviceProviderAPI.startRoute({
        fromChainId: this.quote!.fromChainId,
        fromAssetAddress: this.quote!.fromAsset.address,
        toChainId: this.quote!.toChainId,
        toAssetAddress: this.quote!.toAsset.address,
        route: this.quote!.selectedRoute
      })

      return routeResult
    } catch (error: any) {
      if (shouldThrowOnError) {
        const { message } = getHumanReadableSwapAndBridgeError(error)
        throw new EmittableError({ error, level: 'minor', message })
      }
      return null
    }
  }

  async getNextRouteUserTx({
    activeRouteId,
    activeRoute: { route }
  }: {
    activeRouteId: SwapAndBridgeActiveRoute['activeRouteId']
    activeRoute: SwapAndBridgeActiveRoute
  }) {
    try {
      const response = await this.#serviceProviderAPI.getNextRouteUserTx({
        activeRouteId,
        route: route as SwapAndBridgeRoute // TODO: type cast might not be needed?
      })
      return response
    } catch (error: any) {
      const { message } = getHumanReadableSwapAndBridgeError(error)
      throw new EmittableError({ error, level: 'minor', message })
    }
  }

  async checkForNextUserTxForActiveRoutes() {
    await this.#initialLoadPromise
    const fetchAndUpdateRoute = async (activeRoute: SwapAndBridgeActiveRoute) => {
      let status: SocketRouteStatus = null
      const broadcastedButNotConfirmed = this.#activity.broadcastedButNotConfirmed.find((op) =>
        op.calls.some((c) => c.fromUserRequestId === activeRoute.activeRouteId)
      )

      // call getRouteStatus only after the transaction has processed
      if (broadcastedButNotConfirmed) return
      if (activeRoute.routeStatus === 'completed') return

      try {
        // should never happen
        if (!activeRoute.route) throw new Error('Route data is missing.')

        status = await this.#serviceProviderAPI.getRouteStatus({
          fromChainId: activeRoute.route.fromChainId,
          toChainId: activeRoute.route.toChainId,
          bridge: activeRoute.route.usedBridgeNames?.[0],
          activeRouteId: activeRoute.activeRouteId,
          userTxIndex: activeRoute.userTxIndex,
          txHash: activeRoute.userTxHash!
        })
      } catch (e: any) {
        const { message } = getHumanReadableSwapAndBridgeError(e)
        this.updateActiveRoute(activeRoute.activeRouteId, { error: message })
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
        this.#portfolioUpdate()
      } else if (status === 'ready') {
        this.updateActiveRoute(
          activeRoute.activeRouteId,
          {
            routeStatus: 'ready',
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

  async selectRoute(route: SwapAndBridgeRoute, isAutoSelectDisabled?: boolean) {
    if (!this.quote || !this.quote.routes.length || !this.shouldEnableRoutesSelection) return
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
    if (isAutoSelectDisabled !== undefined) {
      this.isAutoSelectRouteDisabled = isAutoSelectDisabled
    }

    await this.initSignAccountOpIfNeeded()
    this.emitUpdate()
  }

  async addActiveRoute({
    activeRouteId,
    userTxIndex
  }: {
    activeRouteId: SwapAndBridgeActiveRoute['activeRouteId']
    userTxIndex: SwapAndBridgeSendTxRequest['userTxIndex']
  }) {
    await this.#initialLoadPromise

    try {
      let route = this.quote?.routes.find((r) => r.routeId === activeRouteId.toString())
      if (this.#serviceProviderAPI.id === 'socket') {
        route = await this.#serviceProviderAPI.getActiveRoute(activeRouteId.toString())
      }

      if (route) {
        this.activeRoutes.push({
          serviceProviderId: this.#serviceProviderAPI.id,
          activeRouteId: activeRouteId.toString(),
          userTxIndex,
          routeStatus: 'ready',
          userTxHash: null,
          // @ts-ignore TODO: types mismatch by a bit, align types better
          route
        })
      }
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
          let route = currentActiveRoutes[activeRouteIndex].route
          if (this.#serviceProviderAPI.id === 'socket') {
            // @ts-ignore TODO: types mismatch by a bit, align types better
            route = await this.#serviceProviderAPI.getActiveRoute(activeRouteId)
          }
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

      if (activeRoute?.routeStatus === 'completed') {
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
            (tx) => tx.userTxType === 'dex-swap'
          ).length
        }
      }

      this.activeRoutes = currentActiveRoutes

      this.#emitUpdateIfNeeded()
    }
  }

  removeActiveRoute(activeRouteId: SwapAndBridgeSendTxRequest['activeRouteId']) {
    this.activeRoutes = this.activeRoutes.filter((r) => r.activeRouteId !== activeRouteId)

    // Purposely not using `this.#emitUpdateIfNeeded()` here, as this should always emit to update banners
    this.emitUpdate()
  }

  /**
   * Find the next route in line and try to re-estimate with it
   */
  async onEstimationFailure() {
    if (!this.quote || !this.quote.selectedRoute || this.isAutoSelectRouteDisabled) return

    const routeId = this.quote.selectedRoute.routeId
    let routeIndex = null
    this.quote.routes.forEach((route, i) => {
      if (route.routeId === routeId) {
        this.quote!.routes.splice(i, 1)
        routeIndex = i
      }
    })

    // no routes available
    if (routeIndex === null || !this.quote.routes[routeIndex]) {
      this.quote.selectedRoute = undefined
      this.quote.routes = []
      this.emitUpdate()
      return
    }

    await this.selectRoute(this.quote.routes[routeIndex])
  }

  async markSelectedRouteAsFailed() {
    if (!this.quote || !this.quote.selectedRoute) return

    const routeId = this.quote.selectedRoute.routeId
    this.quote.routes.forEach((route, i) => {
      if (route.routeId === routeId) {
        this.quote!.routes[i].hasFailed = true
      }
    })

    this.emitUpdate()
  }

  // update active route if needed on SubmittedAccountOp update
  handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(op: SubmittedAccountOp) {
    op.calls.forEach((call) => {
      this.#handleActiveRouteBroadcastedTransaction(call.fromUserRequestId, op.status)
      this.#handleActiveRouteBroadcastedApproval(call.fromUserRequestId, op.status)
      this.#handleActiveRoutesWithReadyApproval(call.fromUserRequestId, op.status)
      this.#handleUpdateActiveRoutesUserTxData(call.fromUserRequestId, op)
      this.#handleActiveRoutesCompleted(call.fromUserRequestId, op.status)
    })
  }

  #handleActiveRouteBroadcastedTransaction(
    fromUserRequestId: Call['fromUserRequestId'],
    opStatus: SubmittedAccountOp['status']
  ) {
    if (opStatus !== AccountOpStatus.BroadcastedButNotConfirmed) return

    const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === fromUserRequestId)
    if (!activeRoute) return

    this.updateActiveRoute(activeRoute.activeRouteId, { routeStatus: 'in-progress' })
  }

  #handleActiveRouteBroadcastedApproval(
    fromUserRequestId: Call['fromUserRequestId'],
    opStatus: SubmittedAccountOp['status']
  ) {
    if (opStatus !== AccountOpStatus.BroadcastedButNotConfirmed) return

    const activeRoute = this.activeRoutes.find(
      (r) => `${r.activeRouteId}-approval` === fromUserRequestId
    )
    if (!activeRoute) return

    this.updateActiveRoute(activeRoute.activeRouteId, {
      routeStatus: 'waiting-approval-to-resolve'
    })
  }

  #handleActiveRoutesWithReadyApproval(
    fromUserRequestId: Call['fromUserRequestId'],
    opStatus: SubmittedAccountOp['status']
  ) {
    const activeRouteWaitingApproval = this.activeRoutes.find(
      (r) =>
        r.routeStatus === 'waiting-approval-to-resolve' &&
        `${r.activeRouteId}-approval` === fromUserRequestId
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

  #handleUpdateActiveRoutesUserTxData(
    fromUserRequestId: Call['fromUserRequestId'],
    submittedAccountOp: SubmittedAccountOp
  ) {
    const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === fromUserRequestId)
    if (!activeRoute) return

    if (submittedAccountOp && !activeRoute.userTxHash) {
      this.updateActiveRoute(activeRoute.activeRouteId, {
        userTxHash: submittedAccountOp?.txnId,
        identifiedBy: submittedAccountOp.identifiedBy
      })
    }
  }

  #handleActiveRoutesCompleted(
    fromUserRequestId: Call['fromUserRequestId'],
    opStatus: SubmittedAccountOp['status']
  ) {
    const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === fromUserRequestId)
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
      this.fromAmount &&
      this.fromSelectedToken &&
      this.toSelectedToken &&
      this.validateFromAmount.success
    )
  }

  get banners() {
    if (!this.#selectedAccount.account) return []

    const activeRoutesForSelectedAccount = getActiveRoutesForAccount(
      this.#selectedAccount.account.addr,
      this.activeRoutes
    )
    const accountOpActions = this.#actions.visibleActionsQueue.filter(
      ({ type }) => type === 'accountOp'
    ) as AccountOpAction[]

    // Swap banners aren't generated because swaps are completed instantly,
    // thus the activity banner on broadcast is sufficient
    return getBridgeBanners(activeRoutesForSelectedAccount, accountOpActions)
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
    if (!this.signAccountOpController) return
    this.signAccountOpController.reset()
    this.signAccountOpController = null
    this.hasProceeded = false
  }

  async initSignAccountOpIfNeeded() {
    // no updates if the user has commited
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

    const userTxn = await this.getRouteStartUserTx(false)

    // TODO<swap&bridge>: if auto select route is disabled,
    // return the error instead
    // Also, the below code is not working well and needs changes
    //
    // if no txn is provided because of a route failure (large slippage),
    // auto select the next route and continue on
    if (!userTxn) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.onEstimationFailure()
      return
    }

    // learn the token in the portfolio
    this.#portfolio.addTokensToBeLearned([this.toSelectedToken.address], BigInt(this.toChainId))

    // check if we have an accountOp in main
    const userRequestCalls = batchCallsFromUserRequests({
      accountAddr: this.#selectedAccount.account.addr,
      chainId: network.chainId,
      userRequests: this.#userRequests
    })
    const swapOrBridgeCalls = await getSwapAndBridgeCalls(
      userTxn,
      this.#selectedAccount.account,
      provider,
      accountState
    )
    const isBridge = this.fromChainId && this.toChainId && this.fromChainId !== this.toChainId
    const calls = !isBridge ? [...userRequestCalls, ...swapOrBridgeCalls] : [...swapOrBridgeCalls]

    if (this.signAccountOpController) {
      this.signAccountOpController.update({ calls })

      // add the real swapTxn
      if (!this.signAccountOpController.accountOp.meta)
        this.signAccountOpController.accountOp.meta = {}
      this.signAccountOpController.accountOp.meta.swapTxn = userTxn
      return
    }

    const accountOp = {
      accountAddr: this.#selectedAccount.account.addr,
      chainId: network.chainId,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      nonce: accountState.nonce,
      signature: null,
      accountOpToExecuteBefore: null,
      calls,
      flags: {
        hideActivityBanner: this.fromSelectedToken.chainId !== BigInt(this.toSelectedToken.chainId)
      },
      meta: {
        swapTxn: userTxn
      }
    }

    this.signAccountOpController = new SignAccountOpController(
      this.#accounts,
      this.#networks,
      this.#keystore,
      this.#portfolio,
      this.#externalSignerControllers,
      this.#selectedAccount.account,
      network,
      provider,
      randomId(), // the account op and the action are fabricated
      accountOp,
      () => {
        return true
      },
      false,
      undefined
    )

    this.emitUpdate()

    // propagate updates from signAccountOp here
    this.signAccountOpController.onUpdate(() => {
      this.emitUpdate()
    })
    this.signAccountOpController.onError((error) => {
      this.emitError(error)
    })

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.reestimate()
  }

  /**
   * Reestimate the signAccountOp request periodically.
   * Encapsulate it here instead of creating an interval in the background
   * as intervals are tricky and harder to control
   */
  async reestimate() {
    if (this.#isReestimating) return

    this.#isReestimating = true
    await wait(30000)
    this.#isReestimating = false

    if (!this.signAccountOpController) return
    this.signAccountOpController.estimate().catch((e) => {
      // eslint-disable-next-line no-console
      console.log('error on swap&bridge re-estimate')
      // eslint-disable-next-line no-console
      console.log(e)
    })
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.reestimate()
  }

  setUserProceeded(hasProceeded: boolean) {
    this.hasProceeded = hasProceeded
    this.emitUpdate()
  }

  setIsAutoSelectRouteDisabled(isDisabled: boolean) {
    this.isAutoSelectRouteDisabled = isDisabled
    this.emitUpdate()
  }

  get swapSignErrors(): SignAccountOpError[] {
    const errors: SignAccountOpError[] = []
    const isBridge = this.fromChainId && this.toChainId && this.fromChainId !== this.toChainId

    if (
      isBridge &&
      this.fromSelectedToken &&
      this.fromSelectedToken.amountPostSimulation &&
      this.fromSelectedToken.amount !== this.fromSelectedToken.amountPostSimulation
    ) {
      errors.push({
        title: `${this.fromSelectedToken.symbol} detected in batch. Please complete the batch before bridging`
      })
    }

    return errors
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      toTokenList: this.toTokenList,
      maxFromAmount: this.maxFromAmount,
      maxFromAmountInFiat: this.maxFromAmountInFiat,
      validateFromAmount: this.validateFromAmount,
      isFormEmpty: this.isFormEmpty,
      formStatus: this.formStatus,
      activeRoutesInProgress: this.activeRoutesInProgress,
      activeRoutes: this.activeRoutes,
      banners: this.banners,
      isHealthy: this.isHealthy,
      shouldEnableRoutesSelection: this.shouldEnableRoutesSelection,
      supportedChainIds: this.supportedChainIds,
      swapSignErrors: this.swapSignErrors
    }
  }
}
