import { formatUnits, parseUnits } from 'ethers'

import { Storage } from '../../interfaces/storage'
import {
  ActiveRoute,
  SocketAPIQuote,
  SocketAPISendTransactionRequest,
  SocketAPIToken
} from '../../interfaces/swapAndBridge'
import { isSmartAccount } from '../../libs/account/account'
import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import { getQuoteRouteSteps, sortTokenListResponse } from '../../libs/swapAndBridge/swapAndBridge'
import { getSanitizedAmount } from '../../libs/transfer/amount'
import { formatNativeTokenAddressIfNeeded } from '../../services/address'
import { normalizeNativeTokenAddressIfNeeded, SocketAPI } from '../../services/socket/api'
import { validateSendTransferAmount } from '../../services/validations/validate'
import { convertTokenPriceToBigInt } from '../../utils/numbers/formatters'
import { AccountsController } from '../accounts/accounts'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'

const STATUS_WRAPPED_METHODS = {
  updateToTokenList: 'INITIAL',
  updateQuote: 'INITIAL'
} as const

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

export class SwapAndBridgeController extends EventEmitter {
  #accounts: AccountsController

  #networks: NetworksController

  #storage: Storage

  #socketAPI: SocketAPI

  sessionId: string | null = null

  fromChainId: number | null = 1

  fromSelectedToken: TokenResult | null = null

  fromAmount: string = ''

  fromAmountInFiat: string = ''

  fromAmountFieldMode: 'fiat' | 'token' = 'token'

  toChainId: number | null = 10

  toSelectedToken: SocketAPIToken | null = null

  quote: SocketAPIQuote | null = null

  portfolioTokenList: TokenResult[] = []

  toTokenList: SocketAPIToken[] = []

  routePriority: 'output' | 'time' = 'output'

  #activeRoutes: ActiveRoute[] = []

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  constructor({
    accounts,
    networks,
    socketAPI,
    storage
  }: {
    accounts: AccountsController
    networks: NetworksController
    socketAPI: SocketAPI
    storage: Storage
  }) {
    super()
    this.#accounts = accounts
    this.#networks = networks
    this.#socketAPI = socketAPI
    this.#storage = storage

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#initialLoadPromise = this.#load()
  }

  async #load() {
    await this.#networks.initialLoadPromise
    await this.#accounts.initialLoadPromise

    const swapAndBridgeActiveRoutes: ActiveRoute[] = await this.#storage.get(
      'swapAndBridgeActiveRoutes',
      []
    )
    this.activeRoutes = swapAndBridgeActiveRoutes.filter((r) => !!r.userTxHash)

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

    if (this.statuses.updateQuote !== 'INITIAL') return SwapAndBridgeFormStatus.FetchingRoutes

    if (!this.quote?.route) return SwapAndBridgeFormStatus.NoRoutesFound

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

  async initForm(sessionId: string) {
    await this.#initialLoadPromise
    this.resetForm()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.updateToTokenList(false)
    this.activeRoutes = this.activeRoutes.filter((r) => r.routeStatus !== 'completed')
    this.activeRoutes.forEach((r) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateActiveRoute(r.activeRouteId)
    })
    this.sessionId = sessionId
    this.emitUpdate()
  }

  updateForm(props: {
    fromAmount?: string
    fromAmountInFiat?: string
    fromAmountFieldMode?: 'fiat' | 'token'
    fromChainId?: bigint | number
    fromSelectedToken?: TokenResult | null
    toChainId?: bigint | number
    toSelectedToken?: SocketAPIToken | null
    routePriority?: 'output' | 'time'
  }) {
    const {
      fromAmount,
      fromAmountInFiat,
      fromAmountFieldMode,
      fromChainId,
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

    if (fromChainId) {
      if (this.fromChainId !== Number(fromChainId)) {
        this.fromChainId = Number(fromChainId)
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.updateToTokenList(true)
      }
    }

    if (fromSelectedToken) {
      if (this.fromSelectedToken?.networkId !== fromSelectedToken?.networkId) {
        const network = this.#networks.networks.find((n) => n.id === fromSelectedToken.networkId)
        if (network) {
          this.fromChainId = Number(network.chainId)
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

    this.#updateQuote()
    this.emitUpdate()
  }

  resetForm() {
    this.fromChainId = 1
    this.fromSelectedToken = null
    this.fromAmount = ''
    this.fromAmountInFiat = ''
    this.fromAmountFieldMode = 'token'
    this.toChainId = 10
    this.toSelectedToken = null
    this.quote = null
    this.portfolioTokenList = []
    this.toTokenList = []

    this.emitUpdate()
  }

  updatePortfolioTokenList(portfolioTokenList: TokenResult[]) {
    this.portfolioTokenList = portfolioTokenList

    if (!this.fromSelectedToken) {
      this.updateForm({
        fromSelectedToken: this.portfolioTokenList[0] || null
      })
    }

    this.emitUpdate()
  }

  async updateToTokenList(shouldReset: boolean) {
    await this.withStatus(
      'updateToTokenList',
      async () => {
        if (!this.fromChainId || !this.toChainId) return

        if (shouldReset) {
          this.toTokenList = []
          this.toSelectedToken = null
          this.emitUpdate()
        }

        const toTokenListResponse = await this.#socketAPI.getToTokenList({
          fromChainId: this.fromChainId,
          toChainId: this.toChainId
        })
        this.toTokenList = sortTokenListResponse(toTokenListResponse, this.portfolioTokenList)

        if (!this.toSelectedToken) this.updateForm({ toSelectedToken: this.toTokenList[0] || null })

        this.emitUpdate()
      },
      true,
      'silent'
    )
  }

  switchFromAndToTokens() {
    const currentFromSelectedToken = { ...this.fromSelectedToken }
    const currentToSelectedToken = { ...this.toSelectedToken }

    // TODO: Figure out if alternatively, if missing in the portfolio, to convert
    // the `SocketAPIToken` to `TokenResult` via `convertSocketAPITokenToTokenResult`
    const nextFromSelectedToken = this.portfolioTokenList.find(
      (token: TokenResult) =>
        normalizeNativeTokenAddressIfNeeded(token.address)
          // incoming token addresses from Socket (to compare against) are lowercased
          .toLowerCase() === currentToSelectedToken?.address
    )

    const nextToSelectedToken = this.toTokenList.find(
      (t: SocketAPIToken) =>
        t.address ===
        normalizeNativeTokenAddressIfNeeded(currentFromSelectedToken?.address || '')
          // incoming token addresses from Socket (to compare against) are lowercased
          .toLowerCase()
    )

    if (!nextFromSelectedToken || !nextToSelectedToken) {
      return // TODO: Notify the user something went wrong? The UI should prevent this from happening.
    }

    // Reverses the from and to chain ids, since their format is the same
    ;[this.fromChainId, this.toChainId] = [this.toChainId, this.fromChainId]

    this.fromSelectedToken = nextFromSelectedToken
    this.toSelectedToken = nextToSelectedToken

    // TODO: Update quote?
    this.emitUpdate()
  }

  async #updateQuote() {
    await this.withStatus(
      'updateQuote',
      async () => {
        if (!this.#getIsFormValidToFetchQuote()) {
          if (this.quote) {
            this.quote = null
            this.emitUpdate()
          }
          return
        }

        const selectedAccount = this.#accounts.accounts.find(
          (a) => a.addr === this.#accounts.selectedAccount
        )

        const bigintFromAmount = parseUnits(this.fromAmount, this.fromSelectedToken!.decimals)

        if (this.quote) {
          const isFromAmountSame = this.quote.route.fromAmount === bigintFromAmount.toString()
          const isFromNetworkSame = this.quote.fromChainId === this.fromChainId
          const isFromAddressSame =
            formatNativeTokenAddressIfNeeded(this.quote.fromAsset.address) ===
            this.fromSelectedToken!.address
          const isToNetworkSame = this.quote.toChainId === this.toChainId
          const isToAddressSame =
            formatNativeTokenAddressIfNeeded(this.quote.toAsset.address) ===
            this.toSelectedToken!.address

          if (
            isFromAmountSame &&
            isFromNetworkSame &&
            isFromAddressSame &&
            isToNetworkSame &&
            isToAddressSame
          ) {
            return
          }
        }

        if (this.quote) {
          this.quote = null
          this.emitUpdate()
        }

        const quoteResult = await this.#socketAPI.quote({
          fromChainId: this.fromChainId!,
          fromTokenAddress: this.fromSelectedToken!.address,
          toChainId: this.toChainId!,
          toTokenAddress: this.toSelectedToken!.address,
          fromAmount: bigintFromAmount,
          userAddress: this.#accounts.selectedAccount!,
          isSmartAccount: isSmartAccount(selectedAccount),
          sort: this.routePriority
        })

        if (this.#getIsFormValidToFetchQuote() && quoteResult && quoteResult?.routes?.[0]) {
          const bestRoute =
            this.routePriority === 'output'
              ? quoteResult.routes[0] // API returns highest output first
              : quoteResult.routes[quoteResult.routes.length - 1] // API returns fastest... last

          this.quote = {
            fromAsset: quoteResult.fromAsset,
            fromChainId: quoteResult.fromChainId,
            toAsset: quoteResult.toAsset,
            toChainId: quoteResult.toChainId,
            route: bestRoute,
            routeSteps: getQuoteRouteSteps(bestRoute.userTxs)
          }
          this.emitUpdate()
        }
      },
      true
    )
  }

  async getRouteStartUserTx() {
    if (this.formStatus !== SwapAndBridgeFormStatus.ReadyToSubmit) return

    const routeResult = await this.#socketAPI.startRoute({
      fromChainId: this.quote!.fromChainId,
      fromAssetAddress: this.quote!.fromAsset.address,
      toChainId: this.quote!.toChainId,
      toAssetAddress: this.quote!.toAsset.address,
      route: this.quote!.route
    })

    return routeResult
  }

  async checkForNextUserTxForActiveRoutes() {
    await this.#initialLoadPromise
    const fetchAndUpdateRoute = async (activeRoute: ActiveRoute) => {
      let status: 'ready' | 'completed' | null = null
      try {
        status = await this.#socketAPI.getRouteStatus({
          activeRouteId: activeRoute.activeRouteId,
          userTxIndex: activeRoute.userTxIndex,
          txHash: activeRoute.userTxHash!
        })
      } catch (error) {
        console.error(error)
      }

      if (status === 'completed') {
        await this.updateActiveRoute(activeRoute.activeRouteId, {
          routeStatus: 'completed'
        })
      } else if (status === 'ready') {
        await this.updateActiveRoute(activeRoute.activeRouteId, {
          routeStatus: 'ready'
        })
      }
    }

    await Promise.all(
      this.activeRoutesInProgress.map(async (route) => {
        await fetchAndUpdateRoute(route)
      })
    )
  }

  async addActiveRoute(activeRoute: {
    activeRouteId: SocketAPISendTransactionRequest['activeRouteId']
    userTxIndex: SocketAPISendTransactionRequest['userTxIndex']
  }) {
    await this.#initialLoadPromise
    const route = await this.#socketAPI.updateActiveRoute(activeRoute.activeRouteId)
    this.activeRoutes.push({
      ...activeRoute,
      routeStatus: 'in-progress',
      userTxHash: null,
      route
    })
    this.resetForm()

    this.emitUpdate()
  }

  async updateActiveRoute(
    activeRouteId: SocketAPISendTransactionRequest['activeRouteId'],
    activeRoute?: Partial<ActiveRoute>
  ) {
    await this.#initialLoadPromise
    const activeRouteIndex = this.activeRoutes.findIndex((r) => r.activeRouteId === activeRouteId)

    if (activeRouteIndex !== -1) {
      const route = await this.#socketAPI.updateActiveRoute(activeRouteId)

      if (activeRoute) {
        this.activeRoutes[activeRouteIndex] = {
          ...this.activeRoutes[activeRouteIndex],
          ...activeRoute,
          route
        }
      } else {
        this.activeRoutes[activeRouteIndex] = { ...this.activeRoutes[activeRouteIndex], route }
      }

      this.emitUpdate()
    }
  }

  async removeActiveRoute(
    activeRouteId: SocketAPISendTransactionRequest['activeRouteId'],
    type: 'force-remove' | 'remove-if-needed' = 'force-remove'
  ) {
    const route = this.activeRoutes.find((r) => r.activeRouteId === activeRouteId)

    // used to prevent removing the active route when removing the userRequests after a successful signing
    if (type === 'remove-if-needed' && route?.userTxHash) {
      return
    }

    this.activeRoutes = this.activeRoutes.filter((r) => r.activeRouteId !== activeRouteId)

    this.emitUpdate()
  }

  #getIsFormValidToFetchQuote() {
    return (
      this.fromChainId &&
      this.toChainId &&
      this.fromAmount &&
      this.fromSelectedToken &&
      this.toSelectedToken &&
      this.#accounts.selectedAccount &&
      this.validateFromAmount.success
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
      activeRoutes: this.activeRoutes
    }
  }
}