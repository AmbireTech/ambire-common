import { ethErrors } from 'eth-rpc-errors'
import {
  getAddress,
  getBigInt,
  hexlify,
  isAddress,
  TypedDataDomain,
  TypedDataField,
  ZeroAddress
} from 'ethers'
import { v4 as uuidv4 } from 'uuid'
import { hashTypedData, isHex } from 'viem'

import { BindedRelayerCall } from '@/libs/relayerCall/relayerCall'
import { SwapAndBridgeFormStatus } from '@/libs/swapAndBridge/constants'

import EmittableError from '../../classes/EmittableError'
import SwapAndBridgeError from '../../classes/SwapAndBridgeError'
import { Account, AccountOnchainState, IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { AutoLoginStatus, IAutoLoginController } from '../../interfaces/autoLogin'
import { Banner } from '../../interfaces/banner'
import { Dapp, DappProviderRequest, IDappsController } from '../../interfaces/dapp'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { Hex } from '../../interfaces/hex'
import { ExternalSignerController, IKeystoreController } from '../../interfaces/keystore'
import { INetworksController, Network } from '../../interfaces/network'
import { IPhishingController } from '../../interfaces/phishing'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { BuildRequest, IRequestsController } from '../../interfaces/requests'
import { ISafeController } from '../../interfaces/safe'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import {
  ISwapAndBridgeController,
  SwapAndBridgeActiveRoute,
  SwapAndBridgeQuote,
  SwapAndBridgeSendTxRequest
} from '../../interfaces/swapAndBridge'
import { ITransactionManagerController } from '../../interfaces/transactionManager'
import { ITransferController } from '../../interfaces/transfer'
import {
  FocusWindowParams,
  IUiController,
  REQUEST_VIEW_TYPE,
  WindowProps
} from '../../interfaces/ui'
import {
  CallsUserRequest,
  DappCallsRequestParams,
  DappRequestQueueItem,
  OpenRequestWindowParams,
  PendingDappPromise,
  PlainTextMessageUserRequest,
  RequestExecutionType,
  RequestPosition,
  SignUserRequest,
  SiweMessageUserRequest,
  SwapAndBridgeRequest,
  TransferRequest,
  TypedMessageUserRequest,
  UserRequest
} from '../../interfaces/userRequest'
import { isSmartAccount } from '../../libs/account/account'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { AccountOp, getAccountOpNonce, isSafeRejectionCall } from '../../libs/accountOp/accountOp'
import {
  getAccountOpBanners,
  getDappUserRequestsBanners,
  getSafeMessageRequestBanners
} from '../../libs/banners/banners'
import { getDappIdsFromUserRequest } from '../../libs/dapps/dappRequestSpam'
import { getAmbirePaymasterService, getPaymasterService } from '../../libs/erc7677/erc7677'
import { getShouldSimulateInTheBackground } from '../../libs/main/main'
import { TokenResult } from '../../libs/portfolio'
import { PortfolioRewardsResult } from '../../libs/portfolio/interfaces'
import {
  buildSwitchAccountUserRequest,
  dappRequestMethodToRequestKind,
  getCallsUserRequestsByNetwork,
  isSignRequest,
  messageOnNewRequest
} from '../../libs/requests/requests'
import { parse } from '../../libs/richJson/richJson'
import {
  AMBIRE_OPERATION_SIGNING_NOT_ALLOWED_MESSAGE,
  isAmbireOperationTypedData
} from '../../libs/signMessage/signMessage'
import { getSwapAndBridgeRequestParams } from '../../libs/swapAndBridge/swapAndBridge'
import {
  getClaimWalletRequestParams,
  getIntentRequestParams,
  getMintVestingRequestParams,
  getTransferRequestParams
} from '../../libs/transfer/userRequest'
import { generateUuid } from '../../utils/uuid'
import { AutoLoginController } from '../autoLogin/autoLogin'
import EventEmitter from '../eventEmitter/eventEmitter'
import { SignAccountOpController } from '../signAccountOp/signAccountOp'
import { SignAccountOpPreferenceController } from '../signAccountOp/signAccountOpPreference'

import type { Call } from '../../libs/accountOp/types'
import type { EIP712TypedData } from '@safe-global/types-kit'
import type { OnBroadcastFailed, OnBroadcastSuccess } from '../signAccountOp/signAccountOp'

const STATUS_WRAPPED_METHODS = {
  buildSwapAndBridgeUserRequest: 'INITIAL'
} as const

const ONE_CLICK_WINDOW_SIZE = {
  width: 600,
  height: 600
}

/**
 * The RequestsController is responsible for building and managing different user request types (within a request window).
 * Prior to v2.66.0, all request logic resided in the MainController. To improve scalability, readability,
 * and testability, this logic was encapsulated in this dedicated controller.
 *
 * After being opened, the request window will remain visible to the user until all requests are resolved or rejected,
 * or until the user forcefully closes the window using the system close icon (X).
 * After the request window is closed all pending/unresolved requests will be removed except for the requests of type 'calls' to allow batching to an already existing ones.
 */
export class RequestsController extends EventEmitter implements IRequestsController {
  #eventEmitterRegistry?: IEventEmitterRegistryController

  #relayerUrl: string

  #callRelayer: BindedRelayerCall

  #portfolio: IPortfolioController

  #featureFlags: IFeatureFlagsController

  #externalSignerControllers: Partial<{
    internal: ExternalSignerController
    trezor: ExternalSignerController
    ledger: ExternalSignerController
    lattice: ExternalSignerController
  }>

  #activity: IActivityController

  #phishing: IPhishingController

  #dapps: IDappsController

  #accounts: IAccountsController

  #networks: INetworksController

  #providers: IProvidersController

  #storage: IStorageController

  #signAccountOpPreference: SignAccountOpPreferenceController

  #selectedAccount: ISelectedAccountController

  #keystore: IKeystoreController

  #transfer: ITransferController

  #swapAndBridge: ISwapAndBridgeController

  #transactionManager?: ITransactionManagerController

  #ui: IUiController

  #safe: ISafeController

  #autoLogin: IAutoLoginController

  #getDapp: (id: string) => Promise<Dapp | undefined>

  #updateSelectedAccountPortfolio: (networks?: Network[]) => Promise<void>

  #addTokensToBeLearned: (tokenAddresses: string[], chainId: bigint) => void

  #onSetCurrentUserRequest: (currentUserRequest: UserRequest | null) => void

  #onBroadcastSuccess: OnBroadcastSuccess

  #onBroadcastFailed: OnBroadcastFailed

  userRequests: UserRequest[] = []

  userRequestsWaitingAccountSwitch: UserRequest[] = []

  requestWindow: {
    windowProps: WindowProps
    openWindowPromise?: Promise<WindowProps>
    focusWindowPromise?: Promise<WindowProps>
    closeWindowPromise?: Promise<void>
    loaded: boolean
    pendingMessage: {
      message: string
      options?: {
        timeout?: number
        type?: 'error' | 'success' | 'info' | 'warning'
        sticky?: boolean
      }
    } | null
  } = {
    windowProps: null,
    loaded: false,
    pendingMessage: null
  }

  #currentUserRequest: UserRequest | null = null

  /**
   * App requests that would collide with one another, waiting their turn behind the one being
   * built, keyed by what they collide on.
   */
  #dappRequestQueues = new Map<string, DappRequestQueueItem[]>()

  /**
   * Requests that have been built and are about to be added. Prevents opening and closing
   * the request window in a quick succession.
   */
  #userRequestsBeingAdded = 0

  /**
   * Set while the wallet is closing the request view itself. Closing it fires `windowRemoved`,
   * which is the same event the user closing the window produces, so without this the two are
   * indistinguishable and the apps that were waiting look like they were refused.
   */
  #isWalletInitiatedClose = false

  private shouldSimulateAccountOps = true

  get currentUserRequest() {
    return this.#currentUserRequest
  }

  set currentUserRequest(val: UserRequest | null) {
    this.#currentUserRequest = val
    this.#onSetCurrentUserRequest(val)
  }

  #getFirstFreeNonce(accountAddr: string, chainId: bigint, startNonce: bigint): bigint {
    const queuedNonces = this.userRequests.reduce<bigint[]>((nonces, request) => {
      if (
        request.kind !== 'calls' ||
        !request.signAccountOp.account.safeCreation ||
        request.signAccountOp.accountOp.accountAddr !== accountAddr ||
        request.signAccountOp.accountOp.chainId !== chainId
      )
        return nonces

      const nonce = getAccountOpNonce(request.signAccountOp.accountOp)
      if (nonce !== null) nonces.push(nonce)
      return nonces
    }, [])

    let firstFreeNonce = startNonce
    while (queuedNonces.includes(firstFreeNonce)) firstFreeNonce += 1n
    return firstFreeNonce
  }

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor({
    eventEmitterRegistry,
    relayerUrl,
    callRelayer,
    portfolio,
    featureFlags,
    externalSignerControllers,
    activity,
    phishing,
    dapps,
    accounts,
    networks,
    providers,
    storage,
    signAccountOpPreference,
    selectedAccount,
    keystore,
    transfer,
    swapAndBridge,
    transactionManager,
    safe,
    ui,
    autoLogin,
    getDapp,
    updateSelectedAccountPortfolio,
    addTokensToBeLearned,
    onSetCurrentUserRequest,
    onBroadcastSuccess,
    onBroadcastFailed,
    shouldSimulateAccountOps = true
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    relayerUrl: string
    callRelayer: BindedRelayerCall
    portfolio: IPortfolioController
    featureFlags: IFeatureFlagsController
    externalSignerControllers: Partial<{
      internal: ExternalSignerController
      trezor: ExternalSignerController
      ledger: ExternalSignerController
      lattice: ExternalSignerController
    }>
    activity: IActivityController
    phishing: IPhishingController
    dapps: IDappsController
    accounts: IAccountsController
    networks: INetworksController
    providers: IProvidersController
    storage: IStorageController
    signAccountOpPreference: SignAccountOpPreferenceController
    selectedAccount: ISelectedAccountController
    keystore: IKeystoreController
    transfer: ITransferController
    swapAndBridge: ISwapAndBridgeController
    transactionManager?: ITransactionManagerController
    ui: IUiController
    safe: ISafeController
    autoLogin: IAutoLoginController
    getDapp: (id: string) => Promise<Dapp | undefined>
    updateSelectedAccountPortfolio: (networks?: Network[]) => Promise<void>
    addTokensToBeLearned: (tokenAddresses: string[], chainId: bigint) => void
    onSetCurrentUserRequest: (currentUserRequest: UserRequest | null) => void
    onBroadcastSuccess: OnBroadcastSuccess
    onBroadcastFailed: OnBroadcastFailed
    shouldSimulateAccountOps?: boolean
  }) {
    super(eventEmitterRegistry)

    this.#eventEmitterRegistry = eventEmitterRegistry
    this.#relayerUrl = relayerUrl
    this.#callRelayer = callRelayer
    this.#portfolio = portfolio
    this.#featureFlags = featureFlags
    this.#externalSignerControllers = externalSignerControllers
    this.#activity = activity
    this.#phishing = phishing
    this.#dapps = dapps
    this.#accounts = accounts
    this.#networks = networks
    this.#providers = providers
    this.#storage = storage
    this.#signAccountOpPreference = signAccountOpPreference
    this.#selectedAccount = selectedAccount
    this.#keystore = keystore
    this.#transfer = transfer
    this.#swapAndBridge = swapAndBridge
    this.#transactionManager = transactionManager
    this.#ui = ui
    this.#safe = safe
    this.#autoLogin = autoLogin
    this.#getDapp = getDapp
    this.#updateSelectedAccountPortfolio = updateSelectedAccountPortfolio
    this.#addTokensToBeLearned = addTokensToBeLearned
    this.#onSetCurrentUserRequest = onSetCurrentUserRequest
    this.#onBroadcastSuccess = onBroadcastSuccess
    this.#onBroadcastFailed = onBroadcastFailed
    this.shouldSimulateAccountOps = shouldSimulateAccountOps

    this.#ui.window.event.on('windowRemoved', async (winId: number) => {
      // When windowManager.focus is called, it may close and reopen the request window as part of its fallback logic.
      // To avoid prematurely running the cleanup logic during that transition, we wait for focusWindowPromise to resolve.
      await this.requestWindow.focusWindowPromise

      await this.#handleRequestWindowClose(winId)
    })

    this.#ui.window.event.on('windowFocusChange', async (winId: number) => {
      const props = this.requestWindow.windowProps
      if (!props) return

      const newIsFocused = props.id === winId
      if (newIsFocused === props.focused) return

      props.focused = newIsFocused
      this.emitUpdate()
    })

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise
    await this.#accounts.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise
    await this.#keystore.initialLoadPromise
    await this.#safe.initialLoadPromise
    await this.#signAccountOpPreference.initialLoadPromise
  }

  get visibleUserRequests(): UserRequest[] {
    return this.userRequests.filter((r) => {
      if (r.kind === 'calls') {
        return r.signAccountOp.accountOp.accountAddr === this.#selectedAccount.account?.addr
      }
      if (
        r.kind === 'typedMessage' ||
        r.kind === 'message' ||
        r.kind === 'authorization-7702' ||
        r.kind === 'siwe' ||
        r.kind === 'benzin' ||
        r.kind === 'swapAndBridge' ||
        r.kind === 'transfer'
      ) {
        return r.meta.accountAddr === this.#selectedAccount.account?.addr
      }
      if (r.kind === 'switchAccount') {
        return r.meta.switchToAccountAddr !== this.#selectedAccount.account?.addr
      }

      return true
    })
  }

  async addUserRequests(
    reqs: UserRequest[],
    {
      position = 'last',
      executionType = 'open-request-window',
      allowAccountSwitch = false,
      skipFocus = false
    }: {
      position?: RequestPosition
      executionType?: RequestExecutionType
      allowAccountSwitch?: boolean
      skipFocus?: boolean
    } = {}
  ) {
    await this.initialLoadPromise
    const shouldSkipAddUserRequest = await this.#guardHWSigning(false)

    if (shouldSkipAddUserRequest) return

    let baseWindowId: number | undefined

    const userRequestsToAdd = []

    // If any of the requests is a dapp request, we know the source window ID,
    // so we set it as the baseWindowId. This will be used as the reference
    // for the request window that will be opened, making positioning and size
    // calculations more accurate.
    reqs.forEach((r) => {
      r.dappPromises.forEach((p) => {
        if (p.session.windowId && !baseWindowId) baseWindowId = p.session.windowId
      })
    })

    let hasTxInProgressErrorShown = false

    for (const req of reqs) {
      const { kind, meta, dappPromises } = req

      if (
        kind === 'typedMessage' &&
        isAmbireOperationTypedData((meta as TypedMessageUserRequest['meta']).params)
      ) {
        this.#rejectAmbireOperationTypedDataRequest(req as TypedMessageUserRequest)
        continue
      }

      if (allowAccountSwitch && isSignRequest(kind)) {
        if ((meta as SignUserRequest['meta']).accountAddr !== this.#selectedAccount.account?.addr) {
          await this.#addSwitchAccountUserRequest(req as SignUserRequest)
          return
        }
      }

      if (kind === 'calls') {
        const accountOpRequest = this.userRequests.find(
          (r) => r.kind === 'calls' && r.id === `${meta.accountAddr}-${meta.chainId}`
        ) as CallsUserRequest | undefined
        // Prevent adding a new request if a signing or broadcasting process is already in progress for the same account and chain.
        //
        // Why? When a transaction is being signed and broadcast, its calls are still unresolved.
        // If a new request is added during this time, it gets incorrectly attached to the ongoing request.
        // The next time the user starts a transaction, both requests appear in the batch, which is confusing.
        // To avoid this, we block new requests until the current process is complete.
        //
        //  Main issue: https://github.com/AmbireTech/ambire-app/issues/4771
        if (accountOpRequest?.signAccountOp.signAndBroadcastPromise) {
          // Make sure to show the error once
          const errorMessage =
            'Please wait until the previous transaction is fully processed before adding a new one.'

          // Every request turned away here is answered, however many there are - the app is
          // waiting on a promise nobody else will ever settle. Only what the user sees is
          // shown once, so a batch of ten does not produce ten identical toasts.
          dappPromises.forEach((p) => {
            p.reject(ethErrors.rpc.transactionRejected({ message: errorMessage }))
          })

          if (!hasTxInProgressErrorShown) {
            this.emitError({
              level: 'major',
              message: errorMessage,
              error: new Error(
                'requestsController: Cannot add a new request (addUserRequests) while a signing or broadcasting process is still running.'
              )
            })

            await this.#ui.notification.create({ title: 'Rejected!', message: errorMessage })

            hasTxInProgressErrorShown = true
          }

          continue
        }

        const accountStateBefore =
          this.#accounts.accountStates?.[meta.accountAddr]?.[meta.chainId.toString()]

        // Try to update the account state for 3 seconds. If that fails, use the previous account state if it exists,
        // otherwise wait for the fetch to complete (no matter how long it takes).
        // This is done in an attempt to always have the latest nonce, but without blocking the UI for too long if the RPC is slow to respond.
        const accountState = await Promise.race([
          this.#accounts.forceFetchPendingState(meta.accountAddr, meta.chainId),
          // Fallback to the old account state if it exists and the fetch takes too long
          accountStateBefore
            ? // `undefined` included intentionally - previous `accountStateBefore` may not always exist
              new Promise<AccountOnchainState | undefined>((res) => {
                setTimeout(() => res(accountStateBefore), 2000)
              })
            : new Promise<AccountOnchainState>(() => {}) // Explicitly never-resolving promise
        ])

        if (!accountState) {
          const message =
            "Transaction couldn't be processed because required account data couldn't be retrieved. Please try again later or contact Ambire support."
          const error = new Error(
            `requestsController error: accountState for ${meta.accountAddr} is undefined on network with id ${meta.chainId}`
          )
          this.emitError({ level: 'major', message, error })

          req.dappPromises.forEach((p) => {
            p.reject(ethErrors.rpc.internal())
          })
          await this.#ui.notification.create({ title: "Couldn't Process Request", message })

          continue
        }

        userRequestsToAdd.push(req)

        // Even without an initialized SignAccountOpController or Screen, we should still update the portfolio and run the simulation.
        // It's necessary to continue operating with the token `amountPostSimulation` amount.
        if (this.shouldSimulateAccountOps) void this.#performSimulation(req)
      } else if (req.kind === 'typedMessage' || req.kind === 'message' || req.kind === 'siwe') {
        const existingMessageRequest = this.userRequests.find(
          (r) => r.kind === req.kind && r.meta.accountAddr === req.meta.accountAddr
        ) as PlainTextMessageUserRequest | TypedMessageUserRequest | undefined

        // remove the request only if it's not a Safe req
        if (existingMessageRequest && !this.#selectedAccount.account?.safeCreation) {
          existingMessageRequest.meta.accountAddr
          // Taking the old one out empties the view for as long as it takes to add the
          // replacement below, which is not a reason to close it
          this.#userRequestsBeingAdded += 1

          try {
            // The wallet supersedes the older request on its own, so this is not the user
            // refusing the app and must not count towards the spam detection.
            await this.rejectUserRequests(
              'User rejected the message request',
              [existingMessageRequest.id],
              { isUserInitiated: false }
            )
          } finally {
            this.#userRequestsBeingAdded -= 1
          }
        }

        userRequestsToAdd.push(req)
      } else {
        userRequestsToAdd.push(req)
      }
    }

    this.userRequests = this.userRequests.filter((r) => {
      if (r.kind === 'benzin') return false

      if (r.kind === 'switchAccount') {
        return r.meta.switchToAccountAddr !== this.#selectedAccount.account?.addr
      }

      return true
    })

    if (
      this.currentUserRequest &&
      !this.userRequests.find((r) => r.id === this.currentUserRequest!.id)
    ) {
      await this.#setCurrentUserRequest(null)
    }

    userRequestsToAdd.forEach((newReq) => {
      const existingIndex = this.userRequests.findIndex((r) => r.id === newReq.id)

      if (existingIndex !== -1) {
        this.userRequests[existingIndex] = newReq
        if (executionType === 'open-request-window') {
          this.sendNewRequestMessage(newReq, 'updated')
        } else if (executionType === 'queue-but-open-request-window') {
          this.sendNewRequestMessage(newReq, 'queued')
        }
      } else if (position === 'first') {
        this.userRequests.unshift(newReq)
      } else {
        this.userRequests.push(newReq)
      }
    })

    // Every request in the batch was turned away above (an unsupported payload, a transaction
    // already being signed, an account state that could not be fetched), so there is nothing
    // to open a view for - the ones that were turned away have already been answered.
    if (!userRequestsToAdd.length) {
      this.emitUpdate()
      return
    }

    const nextRequest = userRequestsToAdd[0]!

    if (executionType !== 'queue') {
      let currentUserRequest = null
      if (executionType === 'open-request-window') {
        currentUserRequest = this.visibleUserRequests.find((r) => r.id === nextRequest.id) || null
      } else if (executionType === 'queue-but-open-request-window') {
        this.sendNewRequestMessage(nextRequest, 'queued')
        currentUserRequest = this.currentUserRequest || this.visibleUserRequests[0] || null
      }
      await this.#setCurrentUserRequest(currentUserRequest, { skipFocus, baseWindowId })
    } else {
      this.emitUpdate()
    }
  }

  async #performSimulation(curR: CallsUserRequest) {
    try {
      // we don't perform a dashboard simulation on partially signed Safe txns
      // until they are opened on the SignAccountOp screen
      if (
        !!curR.signAccountOp.account.safeCreation &&
        (curR.signAccountOp.accountOp.signed || []).length > 0
      )
        return

      this.#portfolio
        .simulateAccountOp(curR.signAccountOp.accountOp)
        .catch((e) => console.log('Failed to do simulateAccountOp', e))
    } catch (e) {
      console.log('Failed to do #performSimulation', e)
    }
  }

  async #awaitPendingPromises() {
    await this.requestWindow.closeWindowPromise
    await this.requestWindow.focusWindowPromise
    await this.requestWindow.openWindowPromise
  }

  async #setCurrentUserRequest(nextRequest: UserRequest | null, params?: OpenRequestWindowParams) {
    // Pause the previously active signAccountOp request
    if (
      this.currentUserRequest &&
      this.currentUserRequest.kind === 'calls' &&
      this.currentUserRequest.signAccountOp
    ) {
      if (!getShouldSimulateInTheBackground(this.currentUserRequest)) {
        void this.#portfolio.overrideSimulationResults(
          this.currentUserRequest.signAccountOp.accountOp
        )
      }
      this.currentUserRequest.signAccountOp.pause()
    }

    // Resume the signAccountOp of the incoming request
    if (nextRequest && nextRequest.kind === 'calls' && nextRequest.signAccountOp) {
      nextRequest.signAccountOp.resume()
    }

    this.currentUserRequest = nextRequest

    this.emitUpdate()

    if (nextRequest) {
      // Move the request window to the screen the new request needs before it is focused, so
      // switching between requests goes straight from one screen to the next.
      await this.#ui.syncViewRoutes(REQUEST_VIEW_TYPE)
      await this.openRequestWindow(params)
      return
    }

    // Don't close the request window if there are still visible requests or if a request is being added
    if (this.visibleUserRequests.length || this.#userRequestsBeingAdded) return

    await this.closeRequestWindow()
  }

  async openRequestWindow(params?: OpenRequestWindowParams) {
    const { skipFocus, baseWindowId } = params || {}
    await this.#awaitPendingPromises()

    if (this.requestWindow.windowProps) {
      if (!skipFocus) {
        // Force-emitting here updates currentUserRequest on the FE before the window regains focus,
        // preventing the user from briefly seeing the previous request.
        await this.forceEmitUpdate()
        await this.focusRequestWindow()
      }
    } else {
      let customSize

      if (
        this.currentUserRequest?.kind === 'swapAndBridge' ||
        this.currentUserRequest?.kind === 'transfer'
      ) {
        customSize = ONE_CLICK_WINDOW_SIZE
      }

      try {
        // Keep this right after the check above with no await in between, so a second request
        // arriving now finds the open already in progress instead of starting its own.
        this.requestWindow.openWindowPromise = this.#ui.requestView
          .open({ customSize, baseWindowId })
          .then((windowProps) => {
            // Stays null when the request is rendered in the panel instead of a window
            // Set here, not after the await below, so it is already recorded by the time
            // anyone waiting on this promise wakes up and looks for it.
            this.requestWindow.windowProps = windowProps

            return windowProps
          })
          .finally(() => {
            this.requestWindow.openWindowPromise = undefined
          })

        await this.requestWindow.openWindowPromise

        this.emitUpdate()
      } catch (err) {
        this.emitError({
          message:
            'Failed to open a new request window. Please restart your browser if the issue persists.',
          level: 'major',
          error: err as Error
        })
      }
    }
  }

  async focusRequestWindow(params?: FocusWindowParams) {
    await this.#awaitPendingPromises()

    if (
      !this.visibleUserRequests.length ||
      !this.currentUserRequest ||
      !this.requestWindow.windowProps
    )
      return

    try {
      this.requestWindow.focusWindowPromise = this.#ui.requestView
        .focus(this.requestWindow.windowProps, params)
        .finally(() => {
          this.requestWindow.focusWindowPromise = undefined
        })

      const newRequestWindowProps = await this.requestWindow.focusWindowPromise

      if (newRequestWindowProps) {
        this.requestWindow.windowProps = newRequestWindowProps
      }

      this.emitUpdate()
    } catch (err) {
      this.emitError({
        message:
          'Failed to focus the request window. Please restart your browser if the issue persists.',
        level: 'major',
        error: err as Error
      })
    }
  }

  /**
   * Closes the request view and refuses whatever was still waiting in it. Pass
   * `isUserInitiated: false` when the wallet is the one closing it (switching accounts, for
   * example) so the apps that lose their requests are not treated as having been refused.
   */
  async closeRequestWindow({ isUserInitiated = true }: { isUserInitiated?: boolean } = {}) {
    await this.#awaitPendingPromises()

    this.#isWalletInitiatedClose = !isUserInitiated

    if (!this.requestWindow.windowProps) {
      // Rendered inline (in the panel), so closing means dismissing the active request.
      // Guarded, because clearing the current request calls this method too.
      if (this.currentUserRequest)
        await this.#handleRequestWindowClose(undefined, { isUserInitiated })

      return
    }

    // Snapshot before the close is dispatched, not after it completes. Closing the request
    // view is not instant on every platform (on mobile it is a bottom sheet with a ~250ms
    // close animation plus two bridge hops), and requests that arrive while it is closing
    // must not be swept into this close.
    const requestIdsSnapshotAtClose = new Set(this.userRequests.map((r) => r.id))

    this.requestWindow.closeWindowPromise = this.#ui.requestView
      .close(this.requestWindow.windowProps.id)
      .finally(() => {
        this.requestWindow.closeWindowPromise = undefined
      })

    await this.requestWindow.closeWindowPromise

    if (!this.requestWindow.windowProps) return

    await this.#handleRequestWindowClose(this.requestWindow.windowProps.id, {
      requestIdsSnapshot: requestIdsSnapshotAtClose,
      isUserInitiated
    })
  }

  /**
   * `winId` is omitted when the request was rendered inline and had no window of its own.
   * `requestIdsSnapshot` is passed by `closeRequestWindow` so the requests to reject are the
   * ones that existed when the close started, not when the close animation finished. It is
   * omitted on the `windowRemoved` event path, where the close was not initiated here.
   * `isUserInitiated` is false when the wallet closed the view on its own behalf.
   */
  async #handleRequestWindowClose(
    winId?: number,
    // `isUserInitiated` is deliberately left without a default - undefined means "the caller
    // did not say", which is what lets the remembered flag below answer for the event path
    {
      requestIdsSnapshot,
      isUserInitiated
    }: { requestIdsSnapshot?: Set<UserRequest['id']>; isUserInitiated?: boolean } = {}
  ) {
    // The `windowRemoved` path has no caller to say who asked for the close, so it falls back
    // to what the wallet recorded when it started one.
    const isUserInitiatedClose = isUserInitiated ?? !this.#isWalletInitiatedClose

    const isInlineRequestClosed = winId === undefined && !this.requestWindow.windowProps

    if (
      isInlineRequestClosed ||
      winId === this.requestWindow.windowProps?.id ||
      (!this.visibleUserRequests.length &&
        this.currentUserRequest &&
        this.requestWindow.windowProps)
    ) {
      // Cleared only once the close is actually going ahead, so a `windowRemoved` that turns
      // out to be for a different window (the focus fallback swapping one) doesn't eat it.
      this.#isWalletInitiatedClose = false

      // Snapshot IDs synchronously before any awaits so requests that arrive
      // during async operations below are not incorrectly bulk-rejected.
      const requestIdsSnapshotAtClose =
        requestIdsSnapshot || new Set(this.userRequests.map((r) => r.id))

      this.requestWindow.windowProps = null
      this.requestWindow.loaded = false
      this.requestWindow.pendingMessage = null
      await this.#setCurrentUserRequest(null)

      const callsCount = this.visibleUserRequests.reduce((acc, request) => {
        if (request.kind !== 'calls') return acc

        return acc + (request.signAccountOp.accountOp.calls?.length || 0)
      }, 0)

      if (callsCount) {
        await this.#ui.notification.create({
          title: callsCount > 1 ? `${callsCount} transactions queued` : 'Transaction queued',
          message: 'Queued pending transactions are available on your Dashboard.'
        })
      }

      for (const r of this.userRequests) {
        if (r.kind === 'walletAddEthereumChain') {
          const chainId = r.meta.params[0].chainId

          if (!chainId) continue

          const network = this.#networks.networks.find((n) => n.chainId === BigInt(chainId))
          if (network && !network.disabled) await this.resolveUserRequest(null, r.id)
        }
      }

      const userRequestsToRejectOnWindowClose = this.userRequests.filter(
        (r) => r.kind !== 'calls' && !r.meta.keepRequestAlive && requestIdsSnapshotAtClose.has(r.id)
      )

      await this.rejectUserRequests(
        ethErrors.provider.userRejectedRequest().message,
        userRequestsToRejectOnWindowClose.map((r) => r.id),
        // If the user closes a window and non-calls user requests exist,
        // the window will reopen with the next request.
        // For example: if the user has both a sign message and sign account op request,
        // closing the window will reject the sign message request but immediately
        // reopen the window for the sign account op request.
        { shouldOpenNextRequest: false, isUserInitiated: isUserInitiatedClose }
      )

      this.userRequestsWaitingAccountSwitch = []

      // A request that is not in the snapshot arrived while the view was closing (a dapp
      // firing a follow-up right after the previous one resolved, e.g. connect then SIWE).
      // It survived the rejection above, but `#setCurrentUserRequest(null)` cleared it as the
      // current request, so reopen the view with it instead of leaving it without a view.
      const requestArrivedWhileClosing = this.visibleUserRequests.find(
        (r) => !requestIdsSnapshotAtClose.has(r.id)
      )

      if (requestArrivedWhileClosing) {
        await this.#setCurrentUserRequest(requestArrivedWhileClosing)
        return
      }

      this.emitUpdate()
    }
  }

  async rejectCalls({
    callIds = [],
    activeRouteIds: paramActiveRouteIds = [],
    errorMessage = 'User rejected the transaction request!',
    isUserInitiated = true
  }: {
    callIds?: Call['id'][]
    activeRouteIds?: string[]
    errorMessage?: string
    /**
     * Whether the user is removing the calls. False when the wallet tears them down itself,
     * such as when a swap and bridge route is cleaned up.
     */
    isUserInitiated?: boolean
  }) {
    if (!callIds.length && !paramActiveRouteIds.length) return

    const findRequestByCall = (predicate: (c: Call) => boolean) =>
      this.userRequests.find(
        (r) => r.kind === 'calls' && r.signAccountOp.accountOp.calls.some(predicate)
      ) as CallsUserRequest | undefined

    const rejectAndCleanup = async (request: CallsUserRequest, callIdsToRemove: Call['id'][]) => {
      request.signAccountOp.update({
        accountOpData: {
          calls: request.signAccountOp.accountOp.calls.filter((c) => {
            const shouldRemove = callIdsToRemove.some((id) => id === c.id)

            if (shouldRemove) {
              if (c.activeRouteId) this.#swapAndBridge.removeActiveRoute(c.activeRouteId)

              if (c.dappPromiseId) {
                request.dappPromises
                  .find((p) => p.id === c.dappPromiseId)
                  ?.reject(ethErrors.provider.userRejectedRequest<any>(errorMessage))
                request.dappPromises = request.dappPromises.filter((p) => p.id !== c.dappPromiseId)
              }
            }

            return !shouldRemove
          })
        }
      })

      if (!request.signAccountOp.accountOp.calls.length) {
        await this.rejectUserRequests('User rejected the transaction request.', [request.id], {
          shouldOpenNextRequest: true,
          isUserInitiated
        })
      } else {
        this.emitUpdate()
      }
    }

    const activeRouteIdsToRemove = [...paramActiveRouteIds]

    for (const callId of callIds) {
      const request = findRequestByCall((c) => c.id === callId)

      if (!request) continue

      const call = request.signAccountOp.accountOp.calls.find((c) => c.id === callId)

      if (call?.activeRouteId) {
        // What we are doing here is finding all calls for a swap
        // and removing them together if one of them is being removed.
        // Example: The user removes the approval call only,
        // and we also remove the actual swap call.
        if (!activeRouteIdsToRemove.includes(call.activeRouteId)) {
          activeRouteIdsToRemove.push(call.activeRouteId)
        }

        continue
      }

      if (!call) continue

      await rejectAndCleanup(request, [call.id])
    }

    for (const activeRouteId of activeRouteIdsToRemove) {
      const request = findRequestByCall((c) => c.activeRouteId === activeRouteId)

      if (!request) continue

      const callIdsToRemove = request.signAccountOp.accountOp.calls
        .filter((c) => c.activeRouteId === activeRouteId)
        .map((c) => c.id)
        .filter(Boolean) as string[]

      if (callIdsToRemove.length === 0) continue

      await rejectAndCleanup(request, callIdsToRemove)
    }
  }

  async removeUserRequests(
    ids: UserRequest['id'][],
    options?: {
      shouldRemoveSwapAndBridgeRoute?: boolean
      shouldOpenNextRequest?: boolean
      shouldSkipSafeQueueRequests?: boolean
    }
  ) {
    const {
      shouldRemoveSwapAndBridgeRoute = true,
      shouldOpenNextRequest = true,
      shouldSkipSafeQueueRequests = false
    } = options || {}

    const userRequestsToAdd: UserRequest[] = []
    const safeRejectIds: string[] = []
    let didRemoveCurrentUserRequest = false
    let didRemoveSkipQueueRequest = false

    ids.forEach((id) => {
      const req = this.userRequests.find((uReq) => uReq.id === id)

      if (!req) return

      this.userRequests.splice(this.userRequests.indexOf(req), 1)
      if (this.currentUserRequest?.id === req.id) didRemoveCurrentUserRequest = true

      // finishing other requests should not automatically open Safe Queue requests
      if (req.kind !== 'calls') didRemoveSkipQueueRequest = true

      // update the pending stuff to be signed
      const { kind, meta } = req
      if (kind === 'calls') {
        const account = this.#accounts.accounts.find((x) => x.addr === meta.accountAddr)
        if (!account)
          throw new Error(
            `removeUserRequests: tried to run for non-existent account ${meta.accountAddr}`
          )

        if (this.#swapAndBridge.activeRoutes.length && shouldRemoveSwapAndBridgeRoute) {
          req.signAccountOp.accountOp.calls.forEach((c) => {
            if (c.activeRouteId) this.#swapAndBridge.removeActiveRoute(c.activeRouteId)
          })
        }

        req.signAccountOp.destroy()
      }
      if (kind === 'switchAccount') {
        const requestsToAddOrRemove = this.userRequestsWaitingAccountSwitch.filter(
          (r) =>
            isSignRequest(r.kind) &&
            (r as SignUserRequest).meta.accountAddr === this.#selectedAccount.account?.addr
        )

        requestsToAddOrRemove.forEach((r) => {
          this.userRequestsWaitingAccountSwitch.splice(
            this.userRequestsWaitingAccountSwitch.indexOf(r),
            1
          )

          if (
            r.kind === 'typedMessage' &&
            isAmbireOperationTypedData((r as TypedMessageUserRequest).meta.params)
          ) {
            this.#rejectAmbireOperationTypedDataRequest(r as TypedMessageUserRequest)
            return
          }

          userRequestsToAdd.push(r)
        })
      }
      if (kind === 'message' || kind === 'siwe' || kind === 'typedMessage') {
        const account = this.#accounts.accounts.find((x) => x.addr === meta.accountAddr)
        if (!account || !account.safeCreation) return

        safeRejectIds.push(`${meta.hash}`)
      }
    })

    // reject all Safe txns so they do not appear by accident again
    if (safeRejectIds.length) await this.#safe.rejectTxnId(safeRejectIds)

    if (userRequestsToAdd.length) {
      await this.addUserRequests(userRequestsToAdd, { skipFocus: true })
    }

    if (!this.visibleUserRequests.length) {
      await this.#setCurrentUserRequest(null)
    } else if (shouldOpenNextRequest) {
      const shouldSkipSignedSafeCalls =
        (didRemoveSkipQueueRequest || shouldSkipSafeQueueRequests) &&
        !!this.#selectedAccount.account?.safeCreation
      const nextRequest = this.visibleUserRequests.find(
        (request) =>
          !shouldSkipSignedSafeCalls ||
          request.kind !== 'calls' ||
          !request.signAccountOp.accountOp.signed?.length
      )

      await this.#setCurrentUserRequest(nextRequest || null, {
        skipFocus: true
      })
    } else if (didRemoveCurrentUserRequest) {
      await this.#setCurrentUserRequest(null)
    } else {
      this.emitUpdate()
    }
  }

  async resolveUserRequest(data: any, requestId: UserRequest['id']) {
    const userRequest = this.userRequests.find((r) => r.id === requestId)
    if (!userRequest) return // TODO: emit error

    const { kind, meta, dappPromises } = userRequest

    getDappIdsFromUserRequest(userRequest).forEach((dappId) =>
      this.#dapps.clearDappRejections(dappId)
    )

    dappPromises.forEach((p) => {
      // WE SHOULD NEVER RESOLVE THE PROMISE. It should only be rejected if the user rejects the request
      // as that destroys the next request
      if (userRequest.kind === 'switchAccount') return

      p.resolve(data)
    })

    // These requests are transitionary initiated internally (not dApp requests) that block dApp requests
    // before being resolved. The timeout prevents the request-window from closing before the actual dApp request arrives
    if (kind === 'unlock' || kind === 'dappConnect') {
      meta.pendingToRemove = true

      setTimeout(async () => {
        await this.removeUserRequests([requestId])
        this.emitUpdate()
      }, 300)
    } else {
      await this.removeUserRequests([requestId])
      this.emitUpdate()
    }
  }

  /**
   * Counts one refusal against every app that had something in the requests the user just
   * rejected. Deduplicated on purpose: one press of Reject is one refusal, however many
   * requests it clears and however many promises each of them holds.
   */
  #recordDappRejections(userRequests: UserRequest[]) {
    const dappIds = new Set(userRequests.flatMap((r) => getDappIdsFromUserRequest(r)))

    dappIds.forEach((dappId) => this.#dapps.recordDappRejection(dappId))
  }

  /** The app whose request is on screen, or null when the wallet raised the request itself. */
  get #currentRequestDappId(): string | null {
    if (!this.currentUserRequest) return null

    return getDappIdsFromUserRequest(this.currentUserRequest)[0] ?? null
  }

  #getVisibleRequestsFromDapp(dappId: string): UserRequest[] {
    return this.visibleUserRequests.filter((r) => getDappIdsFromUserRequest(r).includes(dappId))
  }

  /**
   * What the user can do about the app behind the open request, beyond refusing it: how many
   * of its requests are queued, and whether it has been refused enough to be worth silencing.
   * Null when the request didn't come from an app.
   */
  get currentRequestRejectOptions(): {
    dappRequestsCount: number
    canSilenceDapp: boolean
  } | null {
    const dappId = this.#currentRequestDappId
    if (!dappId) return null

    return {
      dappRequestsCount: this.#getVisibleRequestsFromDapp(dappId).length,
      canSilenceDapp: this.#dapps.shouldOfferToSilenceDapp(dappId)
    }
  }

  /**
   * Clears everything the app behind the open request is waiting on, and optionally ignores
   * whatever it sends for the next minute. A transaction batch that also holds calls from
   * another app keeps those - only this app's are dropped.
   */
  async rejectAllRequestsFromCurrentDapp(
    err: string,
    { shouldSilenceDapp = false }: { shouldSilenceDapp?: boolean } = {}
  ) {
    const dappId = this.#currentRequestDappId
    if (!dappId) return

    if (shouldSilenceDapp) this.#dapps.silenceDapp(dappId)

    const requestsFromDapp = this.#getVisibleRequestsFromDapp(dappId)
    const requestIdsToReject: UserRequest['id'][] = []
    const callIdsToReject: Call['id'][] = []

    requestsFromDapp.forEach((r) => {
      if (r.kind !== 'calls') {
        requestIdsToReject.push(r.id)
        return
      }

      // Matched through the promise each call was raised for, the same link `rejectCalls`
      // follows, rather than the dapp record on the call - that one is missing for an app
      // the catalog doesn't know.
      const promiseIdsFromDapp = new Set(
        r.dappPromises.filter((p) => p.session?.id === dappId).map((p) => p.id)
      )
      const { calls } = r.signAccountOp.accountOp
      const callIdsFromDapp = calls
        .filter((c) => !!c.dappPromiseId && promiseIdsFromDapp.has(c.dappPromiseId))
        .map((c) => c.id)

      if (callIdsFromDapp.length === calls.length) requestIdsToReject.push(r.id)
      else callIdsToReject.push(...callIdsFromDapp)
    })

    // Everything below is one refusal by the user, so it is counted once, here, rather than
    // once per request the rejections underneath happen to clear.
    this.#recordDappRejections(requestsFromDapp)

    if (callIdsToReject.length)
      await this.rejectCalls({
        callIds: callIdsToReject,
        errorMessage: err,
        isUserInitiated: false
      })

    if (requestIdsToReject.length)
      await this.rejectUserRequests(err, requestIdsToReject, { isUserInitiated: false })
  }

  async rejectUserRequests(
    err: string,
    requestIds: UserRequest['id'][],
    options?: {
      shouldRemoveSwapAndBridgeRoute?: boolean
      shouldOpenNextRequest?: boolean
      /**
       * Whether the user is the one refusing, which is what counts against the app as spam.
       * On by default because nearly every caller is a Reject button. Pass false wherever the
       * wallet rejects on its own behalf - those must never make a legitimate app look hostile.
       */
      isUserInitiated?: boolean
    }
  ) {
    const { isUserInitiated = true, ...removeOptions } = options || {}
    const userRequestsToReject = this.userRequests.filter((r) => requestIds.includes(r.id))
    const rejectedSwitchAccountRequestIds = userRequestsToReject
      .filter((r) => r.kind === 'switchAccount')
      .map((r) => r.id)
    const waitingUserRequestsToReject = this.userRequestsWaitingAccountSwitch.filter((r) =>
      rejectedSwitchAccountRequestIds.includes(r.meta.switchAccountRequestId)
    )

    if (isUserInitiated) this.#recordDappRejections(userRequestsToReject)

    userRequestsToReject.forEach((r) => {
      r.dappPromises.forEach((p) => p.reject(ethErrors.provider.userRejectedRequest<any>(err)))
    })

    const callsUserRequestsToReject = [
      ...userRequestsToReject,
      ...waitingUserRequestsToReject
    ].filter((r) => r.kind === 'calls') as CallsUserRequest[]

    // do not await overrideSimulationResults as the Reject handle becomes slow
    void Promise.all(
      callsUserRequestsToReject.map((r) =>
        this.#portfolio.overrideSimulationResults(r.signAccountOp.accountOp)
      )
    )

    waitingUserRequestsToReject.forEach((r) => {
      if (r.kind === 'calls') r.signAccountOp.destroy()
    })
    this.userRequestsWaitingAccountSwitch = this.userRequestsWaitingAccountSwitch.filter(
      (r) => !waitingUserRequestsToReject.includes(r)
    )

    await this.removeUserRequests(requestIds, {
      ...removeOptions,
      shouldSkipSafeQueueRequests: true
    })
  }

  async build({ type, params }: BuildRequest) {
    await this.initialLoadPromise

    if (type === 'dappRequest') {
      try {
        await this.#processDappRequest(params.request, params.dappPromise)
      } catch (e: any) {
        this.emitError({
          error: e,
          message: `Error processing app request${e.message ? `: ${e.message}` : '.'}`,
          level: 'major'
        })
        throw e
      }
    }

    if (type === 'calls') {
      const { userRequestParams, executionType, ...rest } = params
      const userRequest = await this.#createOrUpdateCallsUserRequest(
        userRequestParams,
        executionType
      )
      if (userRequest) await this.addUserRequests([userRequest], { executionType, ...rest })
    }

    if (type === 'transferRequest') {
      await this.#buildTransferUserRequest(params)
    }

    if (type === 'swapAndBridgeRequest') {
      await this.#buildSwapAndBridgeUserRequest(params)
    }

    if (type === 'claimWalletRequest') {
      await this.#buildClaimWalletUserRequest(params)
    }

    if (type === 'mintVestingRequest') {
      await this.#buildMintVestingUserRequest(params)
    }

    if (type === 'intentRequest') {
      await this.#buildIntentUserRequest(params)
    }

    if (type === 'safeSignMessageRequest') {
      await this.#buildSafeSignMessageUserRequest(params)
    }

    if (type === 'onchainSafeRejection') {
      await this.#buildOnchainSafeRejection(params.requestId)
    }
  }

  /** Builds or focuses a Safe transaction that rejects another transaction onchain. */
  async #buildOnchainSafeRejection(requestId: UserRequest['id']) {
    const request = this.userRequests.find((userRequest) => userRequest.id === requestId)
    if (!request || request.kind !== 'calls') return

    const { account, accountOp } = request.signAccountOp
    const nonce = getAccountOpNonce(accountOp)
    if (!account.safeCreation || nonce === null) return

    try {
      const existingSafeRejectionRequest = this.visibleUserRequests.find(
        (userRequest) =>
          userRequest.id !== request.id &&
          userRequest.kind === 'calls' &&
          !!userRequest.signAccountOp.account.safeCreation &&
          userRequest.meta.accountAddr === accountOp.accountAddr &&
          userRequest.meta.chainId === accountOp.chainId &&
          getAccountOpNonce(userRequest.signAccountOp.accountOp) === nonce &&
          isSafeRejectionCall(
            userRequest.signAccountOp.accountOp.calls,
            userRequest.signAccountOp.accountOp.accountAddr
          )
      )

      if (existingSafeRejectionRequest) {
        if (this.currentUserRequest?.id !== existingSafeRejectionRequest.id) {
          await this.#setCurrentUserRequest(existingSafeRejectionRequest)
        }
        return
      }

      const rejectionRequest = await this.#createOrUpdateCallsUserRequest(
        {
          calls: [{ to: ZeroAddress, value: 0n, data: '0x' }],
          meta: {
            accountAddr: accountOp.accountAddr,
            chainId: accountOp.chainId
          }
        },
        'open-request-window',
        { accountOpNonce: nonce }
      )

      if (rejectionRequest) {
        await this.addUserRequests([rejectionRequest], { executionType: 'open-request-window' })
      }
    } catch (e) {
      this.emitError({
        level: 'major',
        message: 'Could not prepare the transaction rejection. Please try again.',
        error: e instanceof Error ? e : new Error('Failed to build an onchain Safe rejection')
      })
    }
  }

  /**
   * The one place every app request passes through, whatever brought it in - the injected
   * provider, the mobile WebView or WalletConnect. Requests that would collide with one another
   * are queued behind the one being built and built together; everything else builds straight
   * through. Resolves once the request has been added (or answered on the spot), and rejects
   * with what the app should be told, which is what `rpcFlow` turns into the RPC error.
   */
  async #processDappRequest(request: DappProviderRequest, dappPromise: PendingDappPromise) {
    await this.initialLoadPromise

    if (this.#dapps.isDappSilenced(request.session.id)) {
      dappPromise.reject(ethErrors.provider.userRejectedRequest<any>('User rejected the request.'))
      return
    }

    await this.#guardHWSigning(true)

    const dapp = (await this.#getDapp(request.session.id)) || null
    const key = this.#getDappRequestKey(request, dapp)

    if (!key) {
      await this.#buildDappRequest({ request, dappPromise, dapp })
      return
    }

    await this.#enqueueDappRequest(key, { request, dappPromise, dapp })
  }

  /**
   * What two app requests arriving at once would collide over, or null for the ones that can
   * always be built side by side (connecting, adding a chain, watching an asset). Transactions
   * collapse into one batch per account and chain; messages supersede one another per account.
   * Derived from the raw payload rather than a built request, so it never throws on a malformed
   * one - the payload is validated later, per request.
   */
  #getDappRequestKey(request: DappProviderRequest, dapp: Dapp | null): string | null {
    const kind = dappRequestMethodToRequestKind(request.method)

    // Always keyed, malformed payloads included, so every transaction goes through the batch
    // and its params are validated in the one place that knows how to answer only its own app
    if (kind === 'calls') {
      const params = request.params?.[0]
      const chainId = params?.calls && params.chainId ? Number(params.chainId) : dapp?.chainId

      return `calls:${String(params?.from).toLowerCase()}:${chainId}`
    }

    if (kind === 'message' || kind === 'typedMessage') {
      const accountAddr = kind === 'message' ? request.params?.[1] : request.params?.[0]
      if (!accountAddr) return null

      return `${kind}:${String(accountAddr).toLowerCase()}`
    }

    return null
  }

  /**
   * Puts the request in line behind the ones it would collide with and returns when its turn
   * has been served. The first request in also starts the drain, so a queue is never left
   * standing with nobody working it off.
   */
  #enqueueDappRequest(
    key: string,
    item: Pick<DappRequestQueueItem, 'request' | 'dappPromise' | 'dapp'>
  ): Promise<void> {
    const queue = this.#dappRequestQueues.get(key)

    return new Promise<void>((resolve, reject) => {
      const queueItem: DappRequestQueueItem = { ...item, settle: resolve, fail: reject }

      if (queue) {
        queue.push(queueItem)
        return
      }

      this.#dappRequestQueues.set(key, [queueItem])
      void this.#drainDappRequestQueue(key)
    })
  }

  /**
   * Works one queue off in batches, taking everything that has piled up while the previous
   * batch was building. Nothing awaits between finding the queue empty and dropping it, so a
   * request arriving at any point either joins the batch being built or starts a fresh queue.
   */
  async #drainDappRequestQueue(key: string) {
    const queue = this.#dappRequestQueues.get(key)
    if (!queue) return

    try {
      while (queue.length) {
        const batch = queue.splice(0)

        // Every item is answered inside, so this never throws - and it must not, because
        // nothing awaits the drain.
        await this.#buildDappRequestBatch(batch)
      }
    } finally {
      // Just in case, should never happen - a queue left in the map is never drained again,
      // so everything the app sends on this key afterwards waits forever. On the normal path
      // the queue is already empty here and there is nothing left to answer.
      this.#dappRequestQueues.delete(key)
      queue.splice(0).forEach(({ fail }) => fail(ethErrors.rpc.internal()))
    }
  }

  async #buildDappRequestBatch(batch: DappRequestQueueItem[]) {
    // Everything in a batch is the same kind of request, so the first one decides where the
    // whole batch goes. The guard is only here to satisfy the type - a batch is never empty.
    const [first] = batch
    if (!first) return

    if (dappRequestMethodToRequestKind(first.request.method) === 'calls') {
      await this.#buildDappCallsBatch(batch)
      return
    }

    // Only the newest message is ever shown, so the older ones are turned down here. Not via
    // `rejectUserRequests` - that needs built requests, and these were never built.
    const superseded = batch.slice(0, -1)
    superseded.forEach(({ dappPromise, settle }) => {
      dappPromise.reject(
        ethErrors.provider.userRejectedRequest<any>('User rejected the message request')
      )
      settle()
    })

    const last = batch[batch.length - 1]!

    try {
      await this.#buildDappRequest(last)
      last.settle()
    } catch (error) {
      last.fail(error)
    }
  }

  /**
   * Builds every transaction in the batch into a single request, so ten fired at once cost one
   * estimation and one simulation instead of ten. A payload that doesn't validate costs only
   * its own app the request - the rest of the batch is built without it.
   */
  async #buildDappCallsBatch(batch: DappRequestQueueItem[]) {
    const [{ request: firstRequest, dapp }] = batch as [DappRequestQueueItem]

    try {
      if (!this.#selectedAccount.account) throw ethErrors.rpc.internal()

      // Every item in the batch is for the same chain by construction - that is what they were
      // keyed on - so the network and the account state are resolved once for all of them.
      const requestChainId = this.#getDappCallsChainId(firstRequest, dapp)
      const network = this.#networks.networks.find(
        (n) => Number(n.chainId) === Number(requestChainId)
      )
      if (!network) {
        throw ethErrors.provider.chainDisconnected('Transaction failed - unknown network')
      }

      const accountState = await this.#accounts.getOrFetchAccountOnChainState(
        this.#selectedAccount.account.addr,
        network.chainId
      )

      if (!accountState) {
        throw ethErrors.rpc.internal(
          'Transaction failed - unable to fetch account state for the selected account'
        )
      }

      const baseAcc = getBaseAccount(
        this.#selectedAccount.account,
        accountState,
        network,
        this.#featureFlags.isFeatureEnabled('erc4337'),
        this.#featureFlags.isFeatureEnabled('eip7702')
      )

      const built: { item: DappRequestQueueItem; params: DappCallsRequestParams }[] = []

      batch.forEach((item) => {
        try {
          built.push({ item, params: this.#normalizeDappCallsRequest(item, network, baseAcc) })
        } catch (error) {
          item.fail(error)
        }
      })

      if (!built.length) return

      const last = built[built.length - 1]!

      const userRequest = await this.#createOrUpdateCallsUserRequest({
        calls: built.flatMap(({ params }) => params.calls),
        // The batch shares an account and a chain; of what is left, the newest request wins,
        // which is what merging them one by one used to end up with.
        meta: last.params.meta,
        dappPromises: built.map(({ params }) => params.dappPromise),
        dappSessionId: last.item.request.session.sessionId
      })

      if (userRequest) await this.#addBuiltDappRequest(userRequest)

      built.forEach(({ item }) => item.settle())
    } catch (error) {
      // Nothing was built, so every app in the batch is told the same thing
      batch.forEach((item) => item.fail(error))
    }
  }

  /**
   * The chain a transaction request is for. `wallet_sendCalls` (ERC-5792) carries its own,
   * everything else goes on the chain the app is connected to. Reads the payload the same
   * defensive way the key does, so a malformed one falls back to the app's chain instead of
   * throwing and taking the rest of the batch down with it.
   */
  #getDappCallsChainId(request: DappProviderRequest, dapp: Dapp | null) {
    const params = request.params?.[0]

    return params?.calls && params.chainId ? Number(params.chainId) : dapp?.chainId
  }

  /**
   * Validates one transaction request and turns it into the calls and meta a user request is
   * built from. Throws the RPC error the app should be told when the payload doesn't hold up.
   */
  #normalizeDappCallsRequest(
    { request, dappPromise, dapp }: DappRequestQueueItem,
    network: Network,
    baseAcc: ReturnType<typeof getBaseAccount>
  ): DappCallsRequestParams {
    if (!request.params?.[0])
      throw ethErrors.rpc.invalidParams('The transaction request has no parameters.')

    const isWalletSendCalls = !!request.params[0].calls
    const accountAddr = getAddress(request.params[0].from)

    if (isWalletSendCalls && !request.params[0].calls.length)
      throw ethErrors.provider.unsupportedMethod({
        message: 'Request rejected - empty calls array not allowed!'
      })

    const calls: AccountOp['calls'] = isWalletSendCalls
      ? request.params[0].calls
      : [request.params[0]]

    if (calls.some(({ data }) => data && data.length % 2 === 1))
      throw ethErrors.rpc.invalidParams('A call has uneven number of character in the hex data.')
    if (calls.some(({ data }) => data && !isHex(data)))
      throw ethErrors.rpc.invalidParams('A call has invalid data.')

    // we are checking if to exists, because if it does not the call is a
    // valid contract  deployment
    if (calls.some(({ to }) => to && !isAddress(to)))
      throw ethErrors.rpc.invalidParams('A call has invalid "to" field ')

    const paymasterService =
      isWalletSendCalls && !!request.params[0].capabilities?.paymasterService
        ? getPaymasterService(network.chainId, request.params[0].capabilities)
        : getAmbirePaymasterService(baseAcc, this.#relayerUrl)

    return {
      calls: calls.map((c) => ({
        ...c,
        data: c.data?.toLowerCase() || '0x',
        value: c.value ? getBigInt(c.value) : 0n,
        dapp: dapp ?? undefined,
        dappPromiseId: dappPromise.id
      })),
      meta: {
        accountAddr,
        chainId: network.chainId,
        walletSendCallsVersion: isWalletSendCalls
          ? (request.params[0].version ?? '1.0.0')
          : undefined,
        paymasterService
      },
      dappPromise: { ...dappPromise, meta: { isWalletSendCalls } }
    }
  }

  /**
   * Builds one app request that isn't a transaction and hands it on. Resolves without adding
   * anything when the wallet answered the app itself, which is what auto-login does.
   */
  async #buildDappRequest({
    request,
    dappPromise,
    dapp
  }: Pick<DappRequestQueueItem, 'request' | 'dappPromise' | 'dapp'>) {
    const kind = dappRequestMethodToRequestKind(request.method)
    let userRequest: UserRequest | null = null

    if (kind === 'message') {
      userRequest = await this.#buildDappMessageRequest(request, dappPromise, dapp)
    } else if (kind === 'typedMessage') {
      userRequest = this.#buildDappTypedMessageRequest(request, dappPromise, dapp)
    } else {
      // Transactions never reach this point - they are always keyed and always batched
      userRequest = {
        id: generateUuid(),
        kind,
        meta: { params: request.params },
        dappPromises: [{ ...dappPromise, session: request.session, meta: {} }]
      } as UserRequest
    }

    if (!userRequest) return

    await this.#addBuiltDappRequest(userRequest)
  }

  /**
   * A `personal_sign` request as either a plain message or a SIWE one. Returns null when the
   * message was signed by auto-login and the app already has its answer.
   */
  async #buildDappMessageRequest(
    request: DappProviderRequest,
    dappPromise: PendingDappPromise,
    dapp: Dapp | null
  ): Promise<UserRequest | null> {
    if (!this.#selectedAccount.account) throw ethErrors.rpc.internal()

    const msg = request.params
    if (!msg) {
      throw ethErrors.rpc.invalidRequest('No msg request to sign')
    }
    const msgAddress = getAddress(msg?.[1])

    const network = this.#networks.networks.find((n) => Number(n.chainId) === Number(dapp?.chainId))

    if (!network) {
      throw ethErrors.provider.chainDisconnected('Transaction failed - unknown network')
    }

    const userRequest = {
      id: generateUuid(),
      kind: 'message',
      meta: { params: { message: msg[0] }, accountAddr: msgAddress, chainId: network.chainId },
      dappPromises: [
        {
          ...dappPromise,
          session: request.session,
          meta: {}
        }
      ]
    } as PlainTextMessageUserRequest

    // SIWE
    const rawMessage = typeof msg[0] === 'string' ? msg[0] : ''
    const parsedSiweAndStatus = AutoLoginController.getParsedSiweMessage(
      rawMessage,
      request.session.origin
    )

    // Handle valid and invalid SIWE messages
    // If it's valid we want to try to auto-login the user
    // If it's not we want to flag it to the UI to inform the user
    if (!rawMessage || !parsedSiweAndStatus) return userRequest

    const { parsedSiwe, status } = parsedSiweAndStatus
    let autoLoginStatus: AutoLoginStatus = 'no-policy'

    if (parsedSiwe.address?.toLowerCase() !== msgAddress.toLowerCase()) {
      throw ethErrors.rpc.invalidRequest(
        'SIWE message address does not match the requested signing address'
      )
    }

    // Try to auto-login
    if (status === 'valid' && parsedSiwe) {
      try {
        autoLoginStatus = this.#autoLogin.getAutoLoginStatus(parsedSiwe)

        if (autoLoginStatus === 'active') {
          // Sign and respond
          const signedMessage = await this.#autoLogin.autoLogin({
            message: rawMessage as `0x${string}`,
            chainId: network.chainId,
            accountAddr: msgAddress
          })

          if (!signedMessage) {
            throw new EmittableError({
              message: 'Auto-login failed. Please sign the message manually.',
              level: 'major',
              error: new Error('SIWE autologin - signedMessage is null')
            })
          }

          console.log(
            `SIWE auto-login with dapp ${request.session.origin} and account ${msgAddress} succeeded.`
          )

          dappPromise.resolve({ hash: signedMessage.signature })
          return null
        }
      } catch (e: any) {
        this.emitError({
          error: e,
          message: 'Auto-login failed. Please sign the message manually.',
          level: 'major'
        })
      }
    }

    return {
      ...userRequest,
      kind: 'siwe',
      meta: {
        ...userRequest.meta,
        params: {
          ...userRequest.meta.params,
          parsedMessage: parsedSiwe,
          autoLoginStatus,
          siweValidityStatus: status,
          isAutoLoginEnabledByUser: this.#autoLogin.settings.enabled,
          autoLoginDuration: this.#autoLogin.settings.duration
        }
      }
    } as SiweMessageUserRequest
  }

  #buildDappTypedMessageRequest(
    request: DappProviderRequest,
    dappPromise: PendingDappPromise,
    dapp: Dapp | null
  ): UserRequest {
    if (!this.#selectedAccount.account) throw ethErrors.rpc.internal()

    const msg = request.params
    if (!msg) {
      throw ethErrors.rpc.invalidRequest('No msg request to sign')
    }
    const msgAddress = getAddress(msg?.[0])

    const network = this.#networks.networks.find((n) => Number(n.chainId) === Number(dapp?.chainId))

    if (!network) {
      throw ethErrors.provider.chainDisconnected('Transaction failed - unknown network')
    }

    let typedData = msg?.[1]

    try {
      typedData = parse(typedData)
    } catch (error) {
      console.error('Failed to parse typed data', error)
      throw ethErrors.rpc.invalidRequest('Invalid typedData provided')
    }

    if (!typedData?.types || !typedData?.domain || !typedData?.message || !typedData?.primaryType) {
      throw ethErrors.rpc.methodNotSupported(
        'Invalid typedData format - only typedData v4 is supported'
      )
    }

    const domainChainId = BigInt(typedData.domain.chainId || 0)
    if (domainChainId !== 0n && domainChainId !== network.chainId)
      throw ethErrors.rpc.invalidRequest(
        `The domain chainId (${typedData.domain.chainId}) does not match the current network chainId (${network.chainId})`
      )
    typedData.domain.chainId = network.chainId

    if (!typedData.types[typedData.primaryType])
      throw ethErrors.rpc.invalidParams('The primary data type is missing from the provided types')
    try {
      // we ignore the result because we only care if the func will fail
      hashTypedData({
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
        domain: typedData.domain
      })
    } catch (e) {
      console.error(e)
      throw ethErrors.rpc.invalidParams('The message contents did not match the provided types.')
    }

    if (isAmbireOperationTypedData(typedData)) {
      throw ethErrors.rpc.methodNotSupported(AMBIRE_OPERATION_SIGNING_NOT_ALLOWED_MESSAGE)
    }

    return {
      id: generateUuid(),
      kind: 'typedMessage',
      meta: {
        params: {
          types: typedData.types,
          domain: typedData.domain,
          message: typedData.message,
          primaryType: typedData.primaryType
        },
        accountAddr: msgAddress,
        chainId: typedData.domain.chainId
      },
      dappPromises: [{ ...dappPromise, session: request.session, meta: {} }]
    } as TypedMessageUserRequest
  }

  /** Puts a built app request in front of the user, or behind an account switch if it needs one. */
  async #addBuiltDappRequest(userRequest: UserRequest) {
    const [firstDappPromise] = userRequest.dappPromises

    let position: RequestPosition = 'last'

    if (userRequest.kind !== 'calls') {
      const otherUserRequestFromSameDapp = this.userRequests.find((r) =>
        r.dappPromises.some((p) =>
          userRequest.dappPromises
            .map((promise) => promise.session.origin)
            .includes(p.session.origin)
        )
      )

      if (!otherUserRequestFromSameDapp && !!firstDappPromise?.session.origin) {
        position = 'first'
      }
    }

    const isASignOperationRequestedForAnotherAccount =
      isSignRequest(userRequest.kind) &&
      (userRequest as SignUserRequest).meta.accountAddr !== this.#selectedAccount.account?.addr

    // We can simply add the user request if it's not a sign operation
    // for another account
    if (!isASignOperationRequestedForAnotherAccount) {
      await this.addUserRequests([userRequest], {
        position,
        executionType:
          position === 'first' || isSmartAccount(this.#selectedAccount.account)
            ? 'open-request-window'
            : 'queue-but-open-request-window'
      })
      return
    }

    await this.#addSwitchAccountUserRequest(userRequest as SignUserRequest)
  }

  async #buildIntentUserRequest({
    recipientAddress,
    selectedToken,
    executionType = 'open-request-window'
  }: {
    amount: string
    recipientAddress: string
    selectedToken: TokenResult
    executionType: RequestExecutionType
  }) {
    await this.initialLoadPromise
    if (!this.#selectedAccount.account) return

    if (!this.#transactionManager) {
      this.emitError({
        error: new Error('Error: TransactionManagerController feature is not enabled'),
        message: 'This feature is currently disabled',
        level: 'major'
      })
      return
    }

    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      this.#selectedAccount.account.addr,
      selectedToken.chainId
    )

    if (!accountState) {
      this.emitError({
        level: 'major',
        message:
          "Transaction couldn't be processed because required account data couldn't be retrieved. Please try again later or contact Ambire support.",
        error: new Error(
          `requestsController error: accountState for ${
            this.#selectedAccount.account?.addr
          } is undefined on network with id ${selectedToken.chainId}`
        )
      })
      return
    }

    const baseAcc = getBaseAccount(
      this.#selectedAccount.account,
      accountState,
      this.#networks.networks.find((net) => net.chainId === selectedToken.chainId)!,
      this.#featureFlags.isFeatureEnabled('erc4337'),
      this.#featureFlags.isFeatureEnabled('eip7702')
    )

    const requestParams = getIntentRequestParams({
      selectedAccount: this.#selectedAccount.account.addr,
      selectedToken,
      recipientAddress,
      paymasterService: getAmbirePaymasterService(baseAcc, this.#relayerUrl),
      transactions: this.#transactionManager.intent?.transactions
    })

    if (!requestParams) {
      this.emitError({
        level: 'major',
        message: 'Unexpected error while building intent request',
        error: new Error(
          'buildUserRequestFromIntentRequest: bad parameters passed to buildIntentUserRequest'
        )
      })
      return
    }

    const userRequest = await this.#createOrUpdateCallsUserRequest(
      {
        ...requestParams,
        dappPromises: []
      },
      executionType
    )
    if (userRequest) await this.addUserRequests([userRequest], { executionType, position: 'last' })
  }

  async #buildSafeSignMessageUserRequest({
    chainId,
    signed,
    message,
    messageHash,
    created,
    signatures,
    dappName,
    dappUrl
  }: {
    chainId: bigint
    signed: string[]
    message: Hex | EIP712TypedData
    messageHash: Hex
    created: number
    signatures: Hex[]
    dappName?: string
    dappUrl?: string
  }) {
    await this.initialLoadPromise
    if (!this.#selectedAccount.account) return

    // plain text
    if (typeof message === 'string') {
      const req: PlainTextMessageUserRequest = {
        id: uuidv4(),
        kind: 'message',
        dappPromises: [],
        meta: {
          params: { message: message as Hex },
          accountAddr: this.#selectedAccount.account.addr,
          chainId,
          keepRequestAlive: true,
          signed,
          hash: messageHash,
          created,
          signatures,
          dappName,
          dappUrl
        }
      }
      await this.addUserRequests([req], { position: 'last', executionType: 'queue' })
    }

    const typedData = message as EIP712TypedData
    if (typedData.domain.salt && typeof typedData.domain.salt !== 'string') {
      typedData.domain.salt = hexlify(new Uint8Array(typedData.domain.salt))
    }

    // eip-712
    const req: TypedMessageUserRequest = {
      id: uuidv4(),
      kind: 'typedMessage',
      dappPromises: [],
      meta: {
        // basically, it's the same eip-712 message but one is coming
        // from Safe with the Safe typehints, and other is ethers
        params: typedData as {
          domain: TypedDataDomain
          types: Record<string, Array<TypedDataField>>
          message: Record<string, any>
          primaryType: keyof Record<string, Array<TypedDataField>>
        },
        accountAddr: this.#selectedAccount.account.addr,
        chainId,
        keepRequestAlive: true,
        signed,
        hash: messageHash,
        created,
        signatures,
        dappName,
        dappUrl
      }
    }
    await this.addUserRequests([req], { position: 'last', executionType: 'queue' })
  }

  async #buildTransferUserRequest({
    amount,
    amountInFiat,
    recipientAddress,
    recipientDomain,
    selectedToken,
    executionType = 'open-request-window'
  }: {
    amount: string
    amountInFiat: bigint
    recipientAddress: string
    recipientDomain: string | undefined
    selectedToken: TokenResult
    executionType: RequestExecutionType
  }) {
    await this.initialLoadPromise
    if (!this.#selectedAccount.account) return

    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      this.#selectedAccount.account.addr,
      selectedToken.chainId
    )

    if (!accountState) {
      this.emitError({
        level: 'major',
        message:
          "Transaction couldn't be processed because required account data couldn't be retrieved. Please try again later or contact Ambire support.",
        error: new Error(
          `requestsController error: accountState for ${
            this.#selectedAccount.account?.addr
          } is undefined on network with id ${selectedToken.chainId}`
        )
      })
      return
    }

    const baseAcc = getBaseAccount(
      this.#selectedAccount.account,
      accountState,
      this.#networks.networks.find((net) => net.chainId === selectedToken.chainId)!,
      this.#featureFlags.isFeatureEnabled('erc4337'),
      this.#featureFlags.isFeatureEnabled('eip7702')
    )

    const callsRequestParams = getTransferRequestParams({
      selectedAccount: this.#selectedAccount.account.addr,
      amount,
      amountInFiat,
      selectedToken,
      recipientAddress,
      paymasterService: getAmbirePaymasterService(baseAcc, this.#relayerUrl),
      recipientDomain
    })

    if (!callsRequestParams) {
      this.emitError({
        level: 'major',
        message: 'Unexpected error while building transfer request',
        error: new Error(
          'buildUserRequestFromTransferRequest: bad parameters passed to buildTransferUserRequest'
        )
      })
      return
    }

    const userRequest = await this.#createOrUpdateCallsUserRequest(
      callsRequestParams,
      executionType
    )
    if (userRequest) await this.addUserRequests([userRequest], { position: 'last', executionType })
    this.#transfer.resetForm() // reset the transfer form after adding a req
  }

  async #buildSwapAndBridgeUserRequest({
    openActionWindow,
    activeRouteId,
    quote
  }: {
    openActionWindow: boolean
    activeRouteId?: SwapAndBridgeActiveRoute['activeRouteId']
    quote?: SwapAndBridgeQuote
  }) {
    await this.withStatus(
      'buildSwapAndBridgeUserRequest',
      async () => {
        const transaction: SwapAndBridgeSendTxRequest | undefined =
          this.#swapAndBridge.signAccountOpController?.accountOp.meta?.swapTxn

        if (!this.#selectedAccount.account || !transaction) {
          const errorDetails = `missing ${
            this.#selectedAccount.account ? 'selected account' : 'transaction'
          } info`
          const error = new SwapAndBridgeError(
            `Something went wrong when preparing your request. Please try again later or contact Ambire support. Error details: <${errorDetails}>`
          )
          throw new EmittableError({ message: error.message, level: 'major', error })
        }

        // learn the receiving token
        if (this.#swapAndBridge.toSelectedToken && this.#swapAndBridge.toChainId) {
          this.#addTokensToBeLearned(
            [this.#swapAndBridge.toSelectedToken.address],
            BigInt(this.#swapAndBridge.toChainId)
          )
        }

        const network = this.#networks.networks.find(
          (n) => Number(n.chainId) === transaction!.chainId
        )!

        const accountState = await this.#accounts.getOrFetchAccountOnChainState(
          this.#selectedAccount.account.addr,
          network.chainId
        )

        if (!accountState) {
          const error = new SwapAndBridgeError(
            "Required account data couldn't be retrieved. Please try again later or contact Ambire support."
          )
          throw new EmittableError({ message: error.message, level: 'major', error })
        }

        const baseAcc = getBaseAccount(
          this.#selectedAccount.account,
          accountState,
          network,
          this.#featureFlags.isFeatureEnabled('erc4337'),
          this.#featureFlags.isFeatureEnabled('eip7702')
        )
        const swapAndBridgeRequestParams = await getSwapAndBridgeRequestParams(
          transaction,
          network.chainId,
          this.#selectedAccount.account,
          this.#providers.providers[network.chainId.toString()]!,
          accountState,
          getAmbirePaymasterService(baseAcc, this.#relayerUrl),
          quote
        )

        const userRequest = await this.#createOrUpdateCallsUserRequest(
          swapAndBridgeRequestParams,
          openActionWindow ? 'open-request-window' : 'queue'
        )
        if (userRequest) {
          await this.addUserRequests([userRequest], {
            position: 'last',
            executionType: openActionWindow ? 'open-request-window' : 'queue'
          })
        }

        if (this.#swapAndBridge.formStatus === SwapAndBridgeFormStatus.ReadyToSubmit) {
          this.#swapAndBridge.addActiveRoute({
            userTxIndex: transaction.userTxIndex
          })
        }

        if (activeRouteId) {
          this.#swapAndBridge.updateActiveRoute(
            activeRouteId,
            {
              userTxIndex: transaction.userTxIndex,
              userTxHash: null
            },
            true
          )
        }

        this.#swapAndBridge.resetForm()
        if (openActionWindow) {
          this.#swapAndBridge.unloadScreen('popup', true)
        }
      },
      true
    )
  }

  async #buildClaimWalletUserRequest({ token }: { token: TokenResult }) {
    if (!this.#selectedAccount.account) return

    const claimableRewardsData = (
      this.#selectedAccount.portfolio.portfolioState.rewards?.result as PortfolioRewardsResult
    )?.claimableRewardsData

    if (!claimableRewardsData) return

    const userRequestParams = getClaimWalletRequestParams({
      selectedAccount: this.#selectedAccount.account.addr,
      selectedToken: token,
      claimableRewardsData
    })
    const userRequest = await this.#createOrUpdateCallsUserRequest(userRequestParams)
    if (userRequest) await this.addUserRequests([userRequest])
  }

  async #buildMintVestingUserRequest({ token }: { token: TokenResult }) {
    if (!this.#selectedAccount.account) return

    const addrVestingData = (
      this.#selectedAccount.portfolio.portfolioState.rewards?.result as PortfolioRewardsResult
    )?.addrVestingData

    if (!addrVestingData) return
    const userRequestParams = getMintVestingRequestParams({
      selectedAccount: this.#selectedAccount.account.addr,
      selectedToken: token,
      addrVestingData
    })
    const userRequest = await this.#createOrUpdateCallsUserRequest(userRequestParams)
    if (userRequest) await this.addUserRequests([userRequest])
  }

  #rejectAmbireOperationTypedDataRequest(req: TypedMessageUserRequest) {
    req.dappPromises.forEach((p) => {
      p.reject(ethErrors.rpc.methodNotSupported(AMBIRE_OPERATION_SIGNING_NOT_ALLOWED_MESSAGE))
    })
  }

  async #addSwitchAccountUserRequest(req: SignUserRequest) {
    if (req.kind === 'typedMessage' && isAmbireOperationTypedData(req.meta.params)) {
      this.#rejectAmbireOperationTypedDataRequest(req)
      return
    }

    const switchAccountUserRequest = buildSwitchAccountUserRequest({
      nextUserRequest: req,
      selectedAccountAddr: req.meta.accountAddr,
      dappPromises: req.dappPromises
    })
    req.meta.switchAccountRequestId = switchAccountUserRequest.id
    this.userRequestsWaitingAccountSwitch.push(req)
    await this.addUserRequests([switchAccountUserRequest], {
      position: 'last',
      executionType: 'open-request-window'
    })
  }

  // ! IMPORTANT !
  // Banners that depend on async data from sub-controllers should be implemented
  // in the sub-controllers themselves. This is because updates in the sub-controllers
  // will not trigger emitUpdate in the MainController, therefore the banners will
  // remain the same until a subsequent update in the MainController.
  get banners(): Banner[] {
    if (!this.#selectedAccount.account || !this.#networks.isInitialized) return []

    return [
      ...getAccountOpBanners({
        callsUserRequestsByNetwork: getCallsUserRequestsByNetwork(
          this.#selectedAccount.account.addr,
          this.userRequests
        ),
        selectedAccount: this.#selectedAccount.account,
        networks: this.#networks.networks
      }),
      ...getDappUserRequestsBanners(this.#selectedAccount.account, this.visibleUserRequests),
      ...getSafeMessageRequestBanners(this.#selectedAccount.account, this.userRequests)
    ]
  }

  async #createOrUpdateCallsUserRequest(
    {
      calls,
      meta,
      accountOp: providedAccountOp,
      dappPromises = [],
      dappSessionId
    }: {
      calls: Call[]
      meta: CallsUserRequest['meta']
      accountOp?: AccountOp
      dappPromises?: CallsUserRequest['dappPromises']
      dappSessionId?: string
    },
    executionType: RequestExecutionType = 'open-request-window',
    { accountOpNonce }: { accountOpNonce?: bigint } = {}
  ) {
    let callUserRequest: CallsUserRequest | undefined
    const existingUserRequest = this.userRequests.find(
      (r) =>
        r.kind === 'calls' &&
        // done like this so 1) a safe onchain rejection tx is not bundled with a normal batch
        // 2) a fetched rejection is bundled with the current local present rejection
        isSafeRejectionCall(calls, meta.accountAddr) ===
          isSafeRejectionCall(r.signAccountOp.accountOp.calls, meta.accountAddr) &&
        r.meta.accountAddr === meta.accountAddr &&
        r.meta.chainId === meta.chainId &&
        (accountOpNonce === undefined ||
          (!r.signAccountOp.accountOp.signature &&
            getAccountOpNonce(r.signAccountOp.accountOp) === accountOpNonce)) &&
        // find an accountOp with no txnId, if the meta does not have a Safe
        // txnId. If it has, it should not get the existingUserRequest
        ((!meta.safeTxnProps?.txnId && !r.signAccountOp.accountOp.txnId) ||
          // if meta has txnId, the accountOp should have the same txnId
          (meta.safeTxnProps?.txnId &&
            r.signAccountOp.accountOp.txnId &&
            meta.safeTxnProps?.txnId === r.signAccountOp.accountOp.txnId))
    ) as CallsUserRequest | undefined

    if (existingUserRequest) {
      // Prevent updating the signAccountOp if a signing or broadcasting process is already in progress for the same account and chain.
      if (existingUserRequest.signAccountOp.signAndBroadcastPromise) {
        // if the update is coming from Safe Global, just ignore it
        if (meta.safeTxnProps) return

        const errorMessage =
          'Please wait until the previous transaction is fully processed before adding a new one.'

        this.emitError({
          level: 'major',
          message: errorMessage,
          error: new Error(
            'requestsController: Cannot add a new request (addUserRequests) while a signing or broadcasting process is still running.'
          )
        })

        dappPromises.forEach((p) => {
          p.reject(ethErrors.rpc.transactionRejected({ message: errorMessage }))
        })

        if (dappPromises.length) {
          await this.#ui.notification.create({ title: 'Rejected!', message: errorMessage })
        }
      } else {
        if (accountOpNonce !== undefined) {
          existingUserRequest.signAccountOp.setSafeNonce(accountOpNonce)
        }

        // we're allowing updates only on the signature field for
        // already signed accountOps
        if (meta.safeTxnProps) {
          const safeGlobalSig = meta.safeTxnProps.signature
          const accOpSig = existingUserRequest.signAccountOp.accountOp.signature
          if ((accOpSig?.length || 0) < safeGlobalSig.length) {
            existingUserRequest.signAccountOp.update({
              accountOpData: {
                signature: safeGlobalSig,
                txnId: meta.safeTxnProps.txnId,
                nonce: meta.safeTxnProps.nonce,
                safeTx: meta.safeTx
              }
            })
          }

          // if we're updating a signAccountOp with external data (txnId / signature),
          // we do not wish to continue any further down as race conditions may happen
          return
        } else {
          existingUserRequest.signAccountOp.update({
            accountOpData: {
              calls: [
                ...existingUserRequest.signAccountOp.accountOp.calls,
                ...calls.map((call) => ({
                  ...call,
                  id: uuidv4(),
                  // `to` is falsy in contract deployment transactions
                  to: !!call.to ? getAddress(call.to) : call.to,
                  data: call.data || '0x',
                  value: call.value ? getBigInt(call.value) : 0n
                }))
              ],
              meta: {
                ...existingUserRequest.signAccountOp.accountOp.meta,
                ...meta
              }
            }
          })
        }
        existingUserRequest.dappPromises = [...existingUserRequest.dappPromises, ...dappPromises]
      }

      let currentUserRequest = null
      if (executionType === 'open-request-window') {
        currentUserRequest =
          this.visibleUserRequests.find((r) => r.id === existingUserRequest.id) ||
          this.currentUserRequest
      } else if (executionType === 'queue-but-open-request-window') {
        this.sendNewRequestMessage(existingUserRequest, 'queued')
        currentUserRequest = this.currentUserRequest || this.visibleUserRequests[0] || null
      }

      // Otherwise we will reset the currentUserRequest when a new request is added to the batch
      if (executionType !== 'queue') {
        await this.#setCurrentUserRequest(currentUserRequest)
      } else {
        this.emitUpdate()
      }
    } else {
      const account = this.#accounts.accounts.find((x) => x.addr === meta.accountAddr)!
      const accountStateBefore =
        this.#accounts.accountStates?.[meta.accountAddr]?.[meta.chainId.toString()]

      // Try to update the account state for 3 seconds. If that fails, use the previous account state if it exists,
      // otherwise wait for the fetch to complete (no matter how long it takes).
      // This is done in an attempt to always have the latest nonce, but without blocking the UI for too long if the RPC is slow to respond.
      const accountState = (await Promise.race([
        this.#accounts.forceFetchPendingState(meta.accountAddr, meta.chainId),
        // Fallback to the old account state if it exists and the fetch takes too long
        accountStateBefore
          ? new Promise((res) => {
              setTimeout(() => res(accountStateBefore), 2000)
            })
          : new Promise(() => {}) // Explicitly never-resolving promise
      ])) as any

      // do not build requests for expired Safe txns
      if (meta.safeTxnProps && meta.safeTxnProps.nonce < accountState.nonce) return

      const network = this.#networks.networks.find((n) => n.chainId === meta.chainId)!

      const baseRequestId = `${meta.accountAddr}-${meta.chainId}${meta.safeTxnProps?.txnId ? `-${meta.safeTxnProps.txnId}` : ''}`
      // add a unique id for safe requests as we want to make sure
      // new requests do not replace already existing ones
      const requestId = !!account.safeCreation
        ? `${baseRequestId}-${generateUuid()}`
        : baseRequestId
      const initialNonce =
        account.safeCreation && !meta.safeTxnProps && accountOpNonce === undefined
          ? this.#getFirstFreeNonce(meta.accountAddr, meta.chainId, accountState.nonce)
          : (accountOpNonce ?? meta.safeTxnProps?.nonce ?? accountState.nonce)
      await this.#signAccountOpPreference.initialLoadPromise
      callUserRequest = {
        id: requestId,
        kind: 'calls',
        meta,
        signAccountOp: new SignAccountOpController({
          eventEmitterRegistry: this.#eventEmitterRegistry,
          callRelayer: this.#callRelayer,
          accounts: this.#accounts,
          networks: this.#networks,
          keystore: this.#keystore,
          portfolio: this.#portfolio,
          featureFlags: this.#featureFlags,
          signAccountOpPreference: this.#signAccountOpPreference,
          externalSignerControllers: this.#externalSignerControllers,
          activity: this.#activity,
          account,
          network,
          provider: this.#providers.providers[network.chainId.toString()]!,
          phishing: this.#phishing,
          dapps: this.#dapps,
          fromRequestId: requestId,
          accountOp: providedAccountOp
            ? { ...providedAccountOp, nonce: initialNonce }
            : {
                id: generateUuid(),
                accountAddr: meta.accountAddr,
                chainId: meta.chainId,
                signingKeyAddr: null,
                signingKeyType: null,
                gasLimit: null,
                gasFeePayment: null,
                nonce: initialNonce,
                signature: meta.safeTxnProps?.signature ?? null,
                txnId: meta.safeTxnProps?.txnId ?? undefined,
                calls: [
                  ...calls.map((call) => ({
                    ...call,
                    id: uuidv4(),
                    // `to` is falsy in contract deployment transactions
                    to: !!call.to ? getAddress(call.to) : call.to,
                    data: call.data || '0x',
                    value: call.value ? getBigInt(call.value) : 0n
                  }))
                ],
                safeTx: meta.safeTx,
                meta,
                dappSessionId
              },
          shouldSimulate: this.shouldSimulateAccountOps,
          onUpdateAfterTraceCallSuccess: async () => {
            await this.#portfolio.updateSelectedAccount(account.addr, [network])
          },
          onBroadcastSuccess: this.#onBroadcastSuccess,
          onBroadcastFailed: this.#onBroadcastFailed
        }),

        dappPromises
      } as CallsUserRequest

      if (accountOpNonce !== undefined) callUserRequest.signAccountOp.setSafeNonce(accountOpNonce)

      // disable automatic changes to the Safe nonce if a higher one is set
      // unless the user changes it manually
      if (account.safeCreation && initialNonce && initialNonce > accountState.nonce)
        callUserRequest.signAccountOp.setSafeNonce(initialNonce)

      if (executionType !== 'open-request-window') {
        // If the request doesn't open immediately we shouldn't
        // update the estimation and gasPrice in the background,
        // thus we pause the controller until the user opens the request window
        callUserRequest.signAccountOp.pause()
      }

      let lastSafeSignature = callUserRequest.signAccountOp.accountOp.signature
      let lastHumanization = callUserRequest.signAccountOp.humanization

      callUserRequest.signAccountOp.onUpdate((forceEmit) => {
        const callsReq = this.userRequests.find(
          (r) => r.kind === 'calls' && r.signAccountOp.fromRequestId === requestId
        ) as CallsUserRequest | undefined

        if (!callsReq) return

        const safeSignature = callsReq.signAccountOp.accountOp.signature
        const humanization = callsReq.signAccountOp.humanization
        const hasSafeQueueStateChanged =
          !!callsReq.signAccountOp.account.safeCreation &&
          (safeSignature !== lastSafeSignature || humanization !== lastHumanization)

        lastSafeSignature = safeSignature
        lastHumanization = humanization

        if (
          callsReq.signAccountOp.isSignAndBroadcastInProgress ||
          callsReq.signAccountOp.gasFeeChangedConfirmationRequired ||
          hasSafeQueueStateChanged
        ) {
          this.propagateUpdate(forceEmit)
        }
      }, 'requests-ctrl')
    }

    return callUserRequest
  }

  /**
   * Don't allow the user to open new request windows
   * if there's a pending to sign action (swap and bridge or transfer)
   * with a hardware wallet (аpplies to Trezor only, since it doesn't work in a pop-up and must be opened in an request window).
   * This is done to prevent complications with the signing process- e.g. a new request
   * being sent to the hardware wallet while the swap and bridge (or transfer) is still pending.
   * @returns {boolean} - true if an error was thrown
   * @throws {Error} - if throwRpcError is true
   */
  async #guardHWSigning(throwRpcError = false): Promise<boolean> {
    const pendingRequest = this.visibleUserRequests.find(
      ({ kind }) => kind === 'swapAndBridge' || kind === 'transfer'
    ) as SwapAndBridgeRequest | TransferRequest | undefined

    if (!pendingRequest) return false

    const isSigningOrBroadcasting = this.visibleUserRequests.some(
      (r) => r.kind === 'calls' && r.signAccountOp.isSignAndBroadcastInProgress
    )

    // The swap and bridge or transfer is done/forgotten so we can remove the request
    if (!isSigningOrBroadcasting) {
      await this.removeUserRequests([pendingRequest.id])

      if (pendingRequest.kind === 'swapAndBridge') {
        this.#swapAndBridge.reset()
      } else {
        this.#transfer.resetForm()
      }

      return false
    }

    const errors = {
      swapAndBridge: {
        message: 'Please complete the pending swap action.',
        error: 'Pending swap action',
        rpcError: 'You have a pending swap action. Please complete it before signing.'
      },
      transfer: {
        message: 'Please complete the pending transfer action.',
        error: 'Pending transfer action',
        rpcError: 'You have a pending transfer action. Please complete it before signing.'
      }
    }

    const error = errors[pendingRequest.kind as keyof typeof errors]

    // Don't reopen the request window if focusing it fails
    // because closing it will abort the signing process
    await this.focusRequestWindow({ reopenIfNeeded: false })
    this.emitError({
      level: 'expected',
      message: error.message,
      error: new Error(error.error)
    })

    if (throwRpcError) {
      throw ethErrors.rpc.transactionRejected({
        message: error.rpcError
      })
    }

    return true
  }

  async setCurrentUserRequestById(requestId: UserRequest['id'], params?: OpenRequestWindowParams) {
    const request = this.visibleUserRequests.find((r) => r.id === requestId)
    if (!request)
      throw new EmittableError({
        message:
          'Failed to open request window. If the issue persists, please reject the request and try again.',
        level: 'major',
        error: new Error(`UserRequest not found. Id: ${requestId}`)
      })
    await this.#setCurrentUserRequest(request, params)
  }

  async setCurrentUserRequestByIndex(requestIndex: number, params?: OpenRequestWindowParams) {
    const request = this.visibleUserRequests[requestIndex]
    if (!request)
      throw new EmittableError({
        message:
          'Failed to open request window. If the issue persists, please reject the request and try again.',
        level: 'major',
        error: new Error(`UserRequest not found. Index: ${requestIndex}`)
      })
    await this.#setCurrentUserRequest(request, params)
  }

  sendNewRequestMessage(newRequest: UserRequest, type: 'queued' | 'updated') {
    if (this.visibleUserRequests.length > 1 && newRequest.kind !== 'benzin') {
      if (this.requestWindow.loaded) {
        // When the request window is loaded, we don't show messages for dappRequest requests
        // if the current request is also a dappRequest and is pending to be removed
        if (
          this.currentUserRequest &&
          !isSignRequest(this.currentUserRequest.kind) &&
          this.currentUserRequest?.meta?.pendingToRemove
        )
          return

        const message = messageOnNewRequest(newRequest, type)
        if (message) this.#ui.message.sendToastMessage(message, { type: 'success' })
      } else {
        const message = messageOnNewRequest(newRequest, type)
        if (message) this.requestWindow.pendingMessage = { message, options: { type: 'success' } }
      }
    }
  }

  setWindowLoaded() {
    if (!this.requestWindow.windowProps) return
    this.requestWindow.loaded = true

    if (this.requestWindow.pendingMessage) {
      this.#ui.message.sendToastMessage(
        this.requestWindow.pendingMessage.message,
        this.requestWindow.pendingMessage.options
      )
      this.requestWindow.pendingMessage = null
    }
    this.emitUpdate()
  }

  removeAccountData(address: Account['addr']) {
    this.userRequests = this.userRequests.filter((r) => {
      if (r.kind === 'calls') {
        const shouldRemove = r.signAccountOp.accountOp.accountAddr === address
        if (shouldRemove) r.signAccountOp.destroy()

        return !shouldRemove
      }
      if (
        r.kind === 'message' ||
        r.kind === 'typedMessage' ||
        r.kind === 'authorization-7702' ||
        r.kind === 'siwe'
      ) {
        return r.meta.accountAddr !== address
      }
      if (r.kind === 'benzin') {
        return r.meta.accountAddr !== address
      }
      if (r.kind === 'switchAccount') {
        return r.meta.switchToAccountAddr !== address
      }
      if (r.kind === 'swapAndBridge') {
        return r.meta.accountAddr !== address
      }

      return true
    })
    this.emitUpdate()
  }

  getSameNonceSafeRequests(requestId: UserRequest['id']): UserRequest[] {
    const req = this.userRequests.find((uReq) => uReq.id === requestId)
    if (!req || req.kind !== 'calls' || !req.signAccountOp.account.safeCreation) return []

    const broadcastAccountOp = req.signAccountOp.accountOp
    const broadcastNonce = getAccountOpNonce(broadcastAccountOp)
    if (broadcastNonce === null) return []

    return this.userRequests.filter(
      (r) =>
        r.kind === 'calls' &&
        !!r.signAccountOp.account.safeCreation &&
        r.signAccountOp.accountOp.accountAddr === broadcastAccountOp.accountAddr &&
        r.signAccountOp.accountOp.chainId === broadcastAccountOp.chainId &&
        getAccountOpNonce(r.signAccountOp.accountOp) === broadcastNonce &&
        r.id !== requestId
    )
  }

  setPartiallyCompleteRequest(
    requestId: UserRequest['id'],
    meta?: { signed?: string[]; hash?: Hex }
  ): void {
    const req = this.userRequests.find((uReq) => uReq.id === requestId)
    if (!req || (req.kind !== 'message' && req.kind !== 'typedMessage')) return

    req.meta.keepRequestAlive = true
    if (meta?.signed) req.meta.signed = meta.signed
    if (meta?.hash) req.meta.hash = meta.hash
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      banners: this.banners,
      visibleUserRequests: this.visibleUserRequests,
      currentUserRequest: this.currentUserRequest,
      currentRequestRejectOptions: this.currentRequestRejectOptions
    }
  }
}
