import { formatUnits, parseUnits } from 'ethers'

import { Storage } from '../../interfaces/storage'
import {
  ActiveRoute,
  SocketAPIQuote,
  SocketAPIRoute,
  SocketAPISendTransactionRequest,
  SocketAPIToken
} from '../../interfaces/swapAndBridge'
import { isSmartAccount } from '../../libs/account/account'
import { getBridgeBanners } from '../../libs/banners/banners'
import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import {
  getActiveRoutesForAccount,
  getQuoteRouteSteps,
  sortTokenListResponse
} from '../../libs/swapAndBridge/swapAndBridge'
import { getSanitizedAmount } from '../../libs/transfer/amount'
import { SocketAPI } from '../../services/socket/api'
import { validateSendTransferAmount } from '../../services/validations/validate'
import { convertTokenPriceToBigInt } from '../../utils/numbers/formatters'
import wait from '../../utils/wait'
import { AccountOpAction, ActionsController } from '../actions/actions'
import EventEmitter from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'

const HARD_CODED_CURRENCY = 'usd'

const CONVERSION_PRECISION = 16
const CONVERSION_PRECISION_POW = BigInt(10 ** CONVERSION_PRECISION)

export enum SwapAndBridgeFormStatus {
  Empty = 'empty',
  Invalid = 'invalid',
  FetchingRoutes = 'fetching-routes',
  NoRoutesFound = 'no-routes-found',
  ReadyToSubmit = 'ready-to-submit'
}

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

  #storage: Storage

  #socketAPI: SocketAPI

  #activeRoutes: ActiveRoute[] = []

  #updateQuoteThrottle: {
    time: number
    options: {
      skipQuoteUpdateOnSameValues?: boolean
      skipPreviousQuoteRemoval?: boolean
      skipStatusUpdate?: boolean
    }
    throttled: boolean
  } = {
    time: 0,
    options: {},
    throttled: false
  }

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

  updateToTokenListStatus: 'INITIAL' | 'LOADING' = 'INITIAL'

  sessionIds: string[] = []

  fromChainId: number | null = 1

  fromSelectedToken: TokenResult | null = null

  fromAmount: string = ''

  fromAmountInFiat: string = ''

  fromAmountFieldMode: 'fiat' | 'token' = 'token'

  toChainId: number | null = 1

  toSelectedToken: SocketAPIToken | null = null

  quote: SocketAPIQuote | null = null

  portfolioTokenList: TokenResult[] = []

  isTokenListLoading: boolean = false

  toTokenList: SocketAPIToken[] = []

  routePriority: 'output' | 'time' = 'output'

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  constructor({
    selectedAccount,
    networks,
    socketAPI,
    storage,
    actions
  }: {
    selectedAccount: SelectedAccountController
    networks: NetworksController
    socketAPI: SocketAPI
    storage: Storage
    actions: ActionsController
  }) {
    super()
    this.#selectedAccount = selectedAccount
    this.#networks = networks
    this.#socketAPI = socketAPI
    this.#storage = storage
    this.#actions = actions

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#initialLoadPromise = this.#load()
  }

  async #load() {
    await this.#networks.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise

    this.activeRoutes = await this.#storage.get('swapAndBridgeActiveRoutes', [])

    this.#selectedAccount.onUpdate(() => {
      if (this.#selectedAccount.portfolio.isAllReady) {
        this.isTokenListLoading = false
        this.updatePortfolioTokenList(this.#selectedAccount.portfolio.tokens)
      }
    })
    this.emitUpdate()
  }

  get maxFromAmount(): string {
    if (
      !this.fromSelectedToken ||
      getTokenAmount(this.fromSelectedToken) === 0n ||
      !this.fromSelectedToken.decimals
    )
      return '0'

    return formatUnits(getTokenAmount(this.fromSelectedToken), this.fromSelectedToken.decimals)
  }

  get maxFromAmountInFiat(): string {
    if (!this.fromSelectedToken || getTokenAmount(this.fromSelectedToken) === 0n) return '0'

    const tokenPrice = this.fromSelectedToken?.priceIn.find(
      (p) => p.baseCurrency === HARD_CODED_CURRENCY
    )?.price
    if (!tokenPrice || !Number(this.maxFromAmount)) return '0'

    const maxAmount = getTokenAmount(this.fromSelectedToken)
    const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

    // Multiply the max amount by the token price. The calculation is done in big int to avoid precision loss
    return formatUnits(
      maxAmount * tokenPriceBigInt,
      // Shift the decimal point by the number of decimals in the token price
      this.fromSelectedToken.decimals + tokenPriceDecimals
    )
  }

  get formStatus() {
    if (
      !this.fromChainId ||
      !this.toChainId ||
      !this.fromAmount ||
      !this.fromSelectedToken ||
      !this.toSelectedToken
    )
      return SwapAndBridgeFormStatus.Empty

    if (this.validateFromAmount.message) return SwapAndBridgeFormStatus.Invalid

    if (this.updateQuoteStatus !== 'INITIAL') return SwapAndBridgeFormStatus.FetchingRoutes

    if (!this.quote?.selectedRoute) return SwapAndBridgeFormStatus.NoRoutesFound

    return SwapAndBridgeFormStatus.ReadyToSubmit
  }

  get validateFromAmount() {
    if (!this.fromSelectedToken) return { success: false, message: '' }

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

  set activeRoutes(value: ActiveRoute[]) {
    this.#activeRoutes = value
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('swapAndBridgeActiveRoutes', value)
  }

  get isSwitchFromAndToTokensEnabled() {
    if (!this.toSelectedToken) return false
    if (!this.portfolioTokenList.length) return false

    const toSelectedTokenNetwork = this.#networks.networks.find(
      (n) => Number(n.chainId) === this.toChainId
    )!

    return !!this.portfolioTokenList.find(
      (token: TokenResult) =>
        token.address === this.toSelectedToken!.address &&
        token.networkId === toSelectedTokenNetwork.id
    )
  }

  get shouldEnableRoutesSelection() {
    return !!this.quote && !!this.quote.routes && this.quote.routes.length > 1
  }

  async initForm(sessionId: string) {
    await this.#initialLoadPromise

    // reset only if there are no other instances opened/active
    if (!this.sessionIds.length) {
      this.resetForm() // clear prev session form state
      // for each new session remove the completed activeRoutes from the previous session
      this.activeRoutes = this.activeRoutes.filter((r) => r.routeStatus !== 'completed')
      // remove activeRoutes errors from the previous session
      this.activeRoutes.forEach((r) => {
        // eslint-disable-next-line no-param-reassign
        delete r.error
      })
      // update the activeRoute.route prop for the new session
      this.activeRoutes.forEach((r) => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.updateActiveRoute(r.activeRouteId)
      })
    }

    this.sessionIds.push(sessionId)
    await this.#socketAPI.updateHealth()
    this.updatePortfolioTokenList(this.#selectedAccount.portfolio.tokens)

    this.emitUpdate()
  }

  get isHealthy() {
    return this.#socketAPI.isHealthy
  }

  unloadScreen(sessionId: string) {
    this.sessionIds = this.sessionIds.filter((id) => id !== sessionId)
    if (!this.sessionIds.length) this.resetForm()
    this.emitUpdate()
  }

  updateForm(props: {
    fromAmount?: string
    fromAmountInFiat?: string
    fromAmountFieldMode?: 'fiat' | 'token'
    fromSelectedToken?: TokenResult | null
    toChainId?: bigint | number
    toSelectedToken?: SocketAPIToken | null
    routePriority?: 'output' | 'time'
  }) {
    const {
      fromAmount,
      fromAmountInFiat,
      fromAmountFieldMode,
      fromSelectedToken,
      toChainId,
      toSelectedToken,
      routePriority
    } = props
    if (fromAmount !== undefined) {
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

        if (this.fromAmountFieldMode === 'fiat' && this.fromSelectedToken?.decimals) {
          this.fromAmountInFiat = fromAmount

          // Get the number of decimals
          const amountInFiatDecimals = fromAmount.split('.')[1]?.length || 0
          const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

          // Convert the numbers to big int
          const amountInFiatBigInt = parseUnits(fromAmount, amountInFiatDecimals)

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
            fromAmount,
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

    if (fromAmountFieldMode) {
      this.fromAmountFieldMode = fromAmountFieldMode
    }

    if (fromSelectedToken) {
      if (this.fromSelectedToken?.networkId !== fromSelectedToken?.networkId) {
        const network = this.#networks.networks.find((n) => n.id === fromSelectedToken.networkId)
        if (network) {
          this.fromChainId = Number(network.chainId)
          // defaults to swap after network change (should keep fromChainId and toChainId in sync after fromChainId update)
          this.toChainId = Number(network.chainId)
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.updateToTokenList(true)
        }
      }

      this.fromSelectedToken = fromSelectedToken
      this.fromAmount = ''
      this.fromAmountInFiat = ''
      this.fromAmountFieldMode = 'token'
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
      if (this.quote) this.quote = null
    }

    this.updateQuote()

    this.emitUpdate()
  }

  resetForm(shouldEmit?: boolean) {
    this.fromChainId = 1
    this.fromSelectedToken = null
    this.fromAmount = ''
    this.fromAmountInFiat = ''
    this.fromAmountFieldMode = 'token'
    this.toChainId = 1
    this.toSelectedToken = null
    this.quote = null
    this.portfolioTokenList = []
    this.toTokenList = []

    if (shouldEmit) this.emitUpdate()
  }

  updatePortfolioTokenList(nextPortfolioTokenList: TokenResult[]) {
    const tokens =
      nextPortfolioTokenList.filter((token) => {
        const hasAmount = Number(getTokenAmount(token)) > 0

        return hasAmount && !token.flags.onGasTank && !token.flags.rewardsType
      }) || []
    this.portfolioTokenList = tokens

    const fromSelectedTokenInNextPortfolio = tokens.find(
      (t) =>
        t.address === this.fromSelectedToken?.address &&
        t.networkId === this.fromSelectedToken?.networkId
    )
    const shouldUpdateFromSelectedToken =
      !this.fromSelectedToken || // initial (default) state
      // May happen if selected account gets changed or the token gets send away in the meantime
      !fromSelectedTokenInNextPortfolio ||
      // May happen if user receives or sends the token in the meantime
      fromSelectedTokenInNextPortfolio.amount !== this.fromSelectedToken?.amount

    if (shouldUpdateFromSelectedToken) {
      this.updateForm({
        fromSelectedToken: fromSelectedTokenInNextPortfolio || this.portfolioTokenList[0] || null
      })
    } else {
      this.emitUpdate()
    }
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

    if (!this.fromChainId || !this.toChainId) return

    if (shouldReset) {
      this.toTokenList = []
      this.toSelectedToken = null
      this.emitUpdate()
    }

    try {
      const toTokenListResponse = await this.#socketAPI.getToTokenList({
        fromChainId: this.fromChainId,
        toChainId: this.toChainId
      })
      this.toTokenList = sortTokenListResponse(toTokenListResponse, this.portfolioTokenList)

      if (!this.toSelectedToken) {
        if (addressToSelect) {
          const token = this.toTokenList.find((t) => t.address === addressToSelect)
          if (token) {
            this.updateForm({ toSelectedToken: token })
            this.updateToTokenListStatus = 'INITIAL'
            this.emitUpdate()
            return
          }
        }
      }
    } catch (error: any) {
      this.emitError({
        error,
        level: 'major',
        message:
          'Unable to retrieve the list of supported receive tokens. Please reload the tab to try again.'
      })
    }
    this.updateToTokenListStatus = 'INITIAL'
    this.emitUpdate()
  }

  async switchFromAndToTokens() {
    if (!this.isSwitchFromAndToTokensEnabled) return
    const currentFromSelectedToken = { ...this.fromSelectedToken }

    const toSelectedTokenNetwork = this.#networks.networks.find(
      (n) => Number(n.chainId) === this.toChainId
    )!
    this.fromSelectedToken = this.portfolioTokenList.find(
      (token: TokenResult) =>
        token.address === this.toSelectedToken!.address &&
        token.networkId === toSelectedTokenNetwork.id
    )!
    this.fromAmount = '' // Reset fromAmount as it may no longer be valid for the new fromSelectedToken
    // Reverses the from and to chain ids, since their format is the same
    ;[this.fromChainId, this.toChainId] = [this.toChainId, this.fromChainId]
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
    const now = Date.now()
    const timeSinceLastCall = now - this.#updateQuoteThrottle.time
    if (timeSinceLastCall <= 500) {
      this.#updateQuoteThrottle.options = options

      if (!this.#updateQuoteThrottle.throttled) {
        this.#updateQuoteThrottle.throttled = true
        await wait(500 - timeSinceLastCall)
        this.#updateQuoteThrottle.throttled = false
        await this.updateQuote(this.#updateQuoteThrottle.options)
      }
      return
    }
    this.#updateQuoteThrottle.time = now

    const updateQuoteFunction = async () => {
      if (!this.#selectedAccount.account) return

      const sanitizedFromAmount = getSanitizedAmount(
        this.fromAmount,
        this.fromSelectedToken!.decimals
      )
      const bigintFromAmount = parseUnits(sanitizedFromAmount, this.fromSelectedToken!.decimals)

      if (this.quote) {
        const isFromAmountSame = this.quote.selectedRoute.fromAmount === bigintFromAmount.toString()
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

      if (this.quote && !options.skipPreviousQuoteRemoval) {
        this.quote = null
        this.emitUpdate()
      }

      try {
        const quoteResult = await this.#socketAPI.quote({
          fromChainId: this.fromChainId!,
          fromTokenAddress: this.fromSelectedToken!.address,
          toChainId: this.toChainId!,
          toTokenAddress: this.toSelectedToken!.address,
          fromAmount: bigintFromAmount,
          userAddress: this.#selectedAccount.account.addr,
          isSmartAccount: isSmartAccount(this.#selectedAccount.account),
          sort: this.routePriority
        })
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

          const alreadySelectedRoute = quoteResult.routes.find((nextRoute) => {
            if (!this.quote) return false

            // Because we only have routes with unique bridges (bridging case)
            const selectedRouteUsedBridge = this.quote.selectedRoute.usedBridgeNames?.[0]
            if (selectedRouteUsedBridge)
              return nextRoute.usedBridgeNames?.[0] === selectedRouteUsedBridge

            // Assuming to only have routes with unique DEXes (swapping case)
            const selectedRouteUsedDex = this.quote.selectedRoute.usedDexName
            if (selectedRouteUsedDex) return nextRoute.usedDexName === selectedRouteUsedDex

            return false // should never happen, but just in case of bad data
          })
          if (alreadySelectedRoute) {
            routeToSelect = alreadySelectedRoute
            routeToSelectSteps = getQuoteRouteSteps(alreadySelectedRoute.userTxs)
          } else {
            const bestRoute =
              this.routePriority === 'output'
                ? quoteResult.routes[0] // API returns highest output first
                : quoteResult.routes[quoteResult.routes.length - 1] // API returns fastest... last
            routeToSelect = bestRoute
            routeToSelectSteps = getQuoteRouteSteps(bestRoute.userTxs)
          }

          this.quote = {
            fromAsset: quoteResult.fromAsset,
            fromChainId: quoteResult.fromChainId,
            toAsset: quoteResult.toAsset,
            toChainId: quoteResult.toChainId,
            selectedRoute: routeToSelect,
            selectedRouteSteps: routeToSelectSteps,
            routes: quoteResult.routes
          }
        }
      } catch (error: any) {
        this.emitError({
          error,
          level: 'major',
          message: 'Failed to fetch a route for the selected tokens. Please try again.'
        })
      }
    }

    if (!this.#getIsFormValidToFetchQuote()) {
      if (this.quote) {
        this.quote = null
        this.emitUpdate()
      }
      return
    }

    if (!options.skipStatusUpdate) {
      this.updateQuoteStatus = 'LOADING'
      this.emitUpdate()
    }
    await updateQuoteFunction()
    this.updateQuoteStatus = 'INITIAL'

    this.emitUpdate()
  }

  async getRouteStartUserTx() {
    if (this.formStatus !== SwapAndBridgeFormStatus.ReadyToSubmit) return

    const routeResult = await this.#socketAPI.startRoute({
      fromChainId: this.quote!.fromChainId,
      fromAssetAddress: this.quote!.fromAsset.address,
      toChainId: this.quote!.toChainId,
      toAssetAddress: this.quote!.toAsset.address,
      route: this.quote!.selectedRoute
    })

    return routeResult
  }

  async checkForNextUserTxForActiveRoutes() {
    await this.#initialLoadPromise
    const fetchAndUpdateRoute = async (activeRoute: ActiveRoute) => {
      let status: 'ready' | 'completed' | null = null
      let errorMessage: string | null = null
      try {
        const res = await this.#socketAPI.getRouteStatus({
          activeRouteId: activeRoute.activeRouteId,
          userTxIndex: activeRoute.userTxIndex,
          txHash: activeRoute.userTxHash!
        })

        if (res.statusCode !== 200) {
          errorMessage =
            'We have troubles getting the status of this route. Please check back later to proceed.'
        } else {
          status = res.result
        }
      } catch (error) {
        errorMessage =
          'We have troubles getting the status of this route. Please check back later to proceed.'
      }

      if (errorMessage) {
        await this.updateActiveRoute(activeRoute.activeRouteId, {
          error: errorMessage
        })
        return
      }

      const route = this.activeRoutes.find((r) => r.activeRouteId === activeRoute.activeRouteId)
      if (route?.error) {
        await this.updateActiveRoute(activeRoute.activeRouteId, {
          error: undefined
        })
      }

      if (status === 'completed') {
        await this.updateActiveRoute(activeRoute.activeRouteId, {
          routeStatus: 'completed',
          error: undefined
        })
      } else if (status === 'ready') {
        await this.updateActiveRoute(activeRoute.activeRouteId, {
          routeStatus: 'ready',
          error: undefined
        })
      }
    }

    await Promise.all(
      this.activeRoutesInProgress.map(async (route) => {
        await fetchAndUpdateRoute(route)
      })
    )
  }

  selectRoute(route: SocketAPIRoute) {
    if (!this.quote || !this.quote.routes.length || !this.shouldEnableRoutesSelection) return
    if (this.formStatus !== SwapAndBridgeFormStatus.ReadyToSubmit) return

    this.quote.selectedRoute = route
    this.quote.selectedRouteSteps = getQuoteRouteSteps(route.userTxs)

    this.emitUpdate()
  }

  async addActiveRoute(activeRoute: {
    activeRouteId: SocketAPISendTransactionRequest['activeRouteId']
    userTxIndex: SocketAPISendTransactionRequest['userTxIndex']
  }) {
    await this.#initialLoadPromise
    const route = await this.#socketAPI.updateActiveRoute(activeRoute.activeRouteId)
    this.activeRoutes.push({
      ...activeRoute,
      routeStatus: 'ready',
      userTxHash: null,
      route
    })
    this.resetForm(true)
  }

  async updateActiveRoute(
    activeRouteId: SocketAPISendTransactionRequest['activeRouteId'],
    activeRoute?: Partial<ActiveRoute>
  ) {
    await this.#initialLoadPromise
    const currentActiveRoutes = [...this.activeRoutes]
    const activeRouteIndex = currentActiveRoutes.findIndex((r) => r.activeRouteId === activeRouteId)

    if (activeRouteIndex !== -1) {
      let route = currentActiveRoutes[activeRouteIndex].route
      if (activeRoute?.routeStatus) {
        route = await this.#socketAPI.updateActiveRoute(activeRouteId)
      }

      if (activeRoute) {
        currentActiveRoutes[activeRouteIndex] = {
          ...currentActiveRoutes[activeRouteIndex],
          ...activeRoute,
          route
        }
      } else {
        currentActiveRoutes[activeRouteIndex] = { ...currentActiveRoutes[activeRouteIndex], route }
      }
      this.activeRoutes = currentActiveRoutes

      this.emitUpdate()
    }
  }

  removeActiveRoute(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']) {
    this.activeRoutes = this.activeRoutes.filter((r) => r.activeRouteId !== activeRouteId)

    this.emitUpdate()
  }

  onAccountChange() {
    this.portfolioTokenList = []
    this.isTokenListLoading = true

    this.emitUpdate()
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
    return getBridgeBanners(
      activeRoutesForSelectedAccount,
      accountOpActions,
      this.#networks.networks
    )
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      maxFromAmount: this.maxFromAmount,
      maxFromAmountInFiat: this.maxFromAmountInFiat,
      validateFromAmount: this.validateFromAmount,
      formStatus: this.formStatus,
      activeRoutesInProgress: this.activeRoutesInProgress,
      activeRoutes: this.activeRoutes,
      isSwitchFromAndToTokensEnabled: this.isSwitchFromAndToTokensEnabled,
      banners: this.banners,
      isHealthy: this.isHealthy,
      shouldEnableRoutesSelection: this.shouldEnableRoutesSelection
    }
  }
}
