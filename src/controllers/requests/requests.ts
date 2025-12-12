import {
  OnBroadcastFailed,
  OnBroadcastSuccess,
  SignAccountOpController
} from 'controllers/signAccountOp/signAccountOp'
/* eslint-disable no-await-in-loop */
import { ethErrors } from 'eth-rpc-errors'
import { getAddress, getBigInt } from 'ethers'
import { getAccountOpsForSimulation } from 'libs/main/main'
import { v4 as uuidv4 } from 'uuid'

import EmittableError from '../../classes/EmittableError'
import SwapAndBridgeError from '../../classes/SwapAndBridgeError'
import { ORIGINS_WHITELISTED_TO_ALL_ACCOUNTS } from '../../consts/dappCommunication'
import { Account, AccountOnchainState, IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { AutoLoginStatus, IAutoLoginController } from '../../interfaces/autoLogin'
import { Banner } from '../../interfaces/banner'
import { Dapp, DappProviderRequest } from '../../interfaces/dapp'
import { Statuses } from '../../interfaces/eventEmitter'
import { ExternalSignerController, IKeystoreController } from '../../interfaces/keystore'
import { StatusesWithCustom } from '../../interfaces/main'
import { INetworksController, Network } from '../../interfaces/network'
import { IPhishingController } from '../../interfaces/phishing'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { BuildRequest, IRequestsController } from '../../interfaces/requests'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import {
  ISwapAndBridgeController,
  SwapAndBridgeActiveRoute,
  SwapAndBridgeSendTxRequest
} from '../../interfaces/swapAndBridge'
import { ITransactionManagerController } from '../../interfaces/transactionManager'
import { ITransferController } from '../../interfaces/transfer'
import { FocusWindowParams, IUiController, WindowProps } from '../../interfaces/ui'
import {
  CallsUserRequest,
  OpenRequestWindowParams,
  PlainTextMessageUserRequest,
  RequestExecutionType,
  RequestPosition,
  SignUserRequest,
  SiweMessageUserRequest,
  TypedMessageUserRequest,
  UserRequest
} from '../../interfaces/userRequest'
import { isSmartAccount } from '../../libs/account/account'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { Call } from '../../libs/accountOp/types'
import { getAccountOpBanners, getDappUserRequestsBanners } from '../../libs/banners/banners'
import { getAmbirePaymasterService, getPaymasterService } from '../../libs/erc7677/erc7677'
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
  getActiveRoutesForAccount,
  getSwapAndBridgeRequestParams
} from '../../libs/swapAndBridge/swapAndBridge'
import {
  getClaimWalletRequestParams,
  getIntentRequestParams,
  getMintVestingRequestParams,
  getTransferRequestParams
} from '../../libs/transfer/userRequest'
import generateSpoofSig from '../../utils/generateSpoofSig'
import { AutoLoginController } from '../autoLogin/autoLogin'
import EventEmitter from '../eventEmitter/eventEmitter'
import { SwapAndBridgeFormStatus } from '../swapAndBridge/swapAndBridge'

const STATUS_WRAPPED_METHODS = {
  buildSwapAndBridgeUserRequest: 'INITIAL'
} as const

const SWAP_AND_BRIDGE_WINDOW_SIZE = {
  width: 640,
  height: 640
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
  #relayerUrl: string

  #callRelayer: Function

  #portfolio: IPortfolioController

  #externalSignerControllers: Partial<{
    internal: ExternalSignerController
    trezor: ExternalSignerController
    ledger: ExternalSignerController
    lattice: ExternalSignerController
  }>

  #activity: IActivityController

  #phishing: IPhishingController

  #accounts: IAccountsController

  #networks: INetworksController

  #providers: IProvidersController

  #selectedAccount: ISelectedAccountController

  #keystore: IKeystoreController

  #transfer: ITransferController

  #swapAndBridge: ISwapAndBridgeController

  #transactionManager?: ITransactionManagerController

  #ui: IUiController

  #autoLogin: IAutoLoginController

  #getDapp: (id: string) => Promise<Dapp | undefined>

  #getMainStatuses: () => StatusesWithCustom

  #destroySignAccountOp: () => void

  #updateSelectedAccountPortfolio: (networks?: Network[]) => Promise<void>

  #addTokensToBeLearned: (tokenAddresses: string[], chainId: bigint) => void

  #guardHWSigning: (throwRpcError: boolean) => Promise<boolean>

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

  get currentUserRequest() {
    return this.#currentUserRequest
  }

  set currentUserRequest(val: UserRequest | null) {
    this.#currentUserRequest = val
    this.#onSetCurrentUserRequest(val)
  }

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor({
    relayerUrl,
    callRelayer,
    portfolio,
    externalSignerControllers,
    activity,
    phishing,
    accounts,
    networks,
    providers,
    selectedAccount,
    keystore,
    transfer,
    swapAndBridge,
    transactionManager,
    ui,
    autoLogin,
    getDapp,
    destroySignAccountOp,
    updateSelectedAccountPortfolio,
    addTokensToBeLearned,
    guardHWSigning,
    getMainStatuses,
    onSetCurrentUserRequest,
    onBroadcastSuccess,
    onBroadcastFailed
  }: {
    relayerUrl: string
    callRelayer: Function
    portfolio: IPortfolioController
    externalSignerControllers: Partial<{
      internal: ExternalSignerController
      trezor: ExternalSignerController
      ledger: ExternalSignerController
      lattice: ExternalSignerController
    }>
    activity: IActivityController
    phishing: IPhishingController
    accounts: IAccountsController
    networks: INetworksController
    providers: IProvidersController
    selectedAccount: ISelectedAccountController
    keystore: IKeystoreController
    transfer: ITransferController
    swapAndBridge: ISwapAndBridgeController
    transactionManager?: ITransactionManagerController
    ui: IUiController
    autoLogin: IAutoLoginController
    getDapp: (id: string) => Promise<Dapp | undefined>
    destroySignAccountOp: () => void
    updateSelectedAccountPortfolio: (networks?: Network[]) => Promise<void>
    addTokensToBeLearned: (tokenAddresses: string[], chainId: bigint) => void
    guardHWSigning: (throwRpcError: boolean) => Promise<boolean>
    getMainStatuses: () => StatusesWithCustom
    onSetCurrentUserRequest: (currentUserRequest: UserRequest | null) => void
    onBroadcastSuccess: OnBroadcastSuccess
    onBroadcastFailed: OnBroadcastFailed
  }) {
    super()

    this.#relayerUrl = relayerUrl
    this.#callRelayer = callRelayer
    this.#portfolio = portfolio
    this.#externalSignerControllers = externalSignerControllers
    this.#activity = activity
    this.#phishing = phishing
    this.#accounts = accounts
    this.#networks = networks
    this.#providers = providers
    this.#selectedAccount = selectedAccount
    this.#keystore = keystore
    this.#transfer = transfer
    this.#swapAndBridge = swapAndBridge
    this.#transactionManager = transactionManager
    this.#ui = ui
    this.#autoLogin = autoLogin
    this.#getDapp = getDapp
    this.#getMainStatuses = getMainStatuses
    this.#destroySignAccountOp = destroySignAccountOp
    this.#updateSelectedAccountPortfolio = updateSelectedAccountPortfolio
    this.#addTokensToBeLearned = addTokensToBeLearned
    this.#guardHWSigning = guardHWSigning
    this.#onSetCurrentUserRequest = onSetCurrentUserRequest
    this.#onBroadcastSuccess = onBroadcastSuccess
    this.#onBroadcastFailed = onBroadcastFailed

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

    const signAccountOpController = this.#getSignAccountOp()
    const signStatus = this.#getMainStatuses().signAndBroadcastAccountOp
    let hasTxInProgressErrorShown = false

    // eslint-disable-next-line no-restricted-syntax
    for (const req of reqs) {
      const { kind, meta, dappPromises } = req

      if (allowAccountSwitch && isSignRequest(kind)) {
        if ((meta as SignUserRequest['meta']).accountAddr !== this.#selectedAccount.account?.addr) {
          await this.#addSwitchAccountUserRequest(req as SignUserRequest)
          return
        }
      }

      if (kind === 'calls') {
        // Prevent adding a new request if a signing or broadcasting process is already in progress for the same account and chain.
        //
        // Why? When a transaction is being signed and broadcast, its calls are still unresolved.
        // If a new request is added during this time, it gets incorrectly attached to the ongoing request.
        // The next time the user starts a transaction, both requests appear in the batch, which is confusing.
        // To avoid this, we block new requests until the current process is complete.
        //
        //  Main issue: https://github.com/AmbireTech/ambire-app/issues/4771
        if (
          signStatus === 'LOADING' &&
          signAccountOpController?.accountOp.accountAddr === meta.accountAddr &&
          signAccountOpController?.accountOp.chainId === meta.chainId
        ) {
          // Make sure to show the error once
          if (!hasTxInProgressErrorShown) {
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

            await this.#ui.notification.create({ title: 'Rejected!', message: errorMessage })

            hasTxInProgressErrorShown = true
          }

          return
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

          return
        }

        userRequestsToAdd.push(req)

        const signAccountOp = this.#getSignAccountOp()
        if (signAccountOp) {
          if (signAccountOp.fromRequestId === req.id) {
            this.#updateSignAccountOp({ accountOpData: { calls: req.accountOp.calls } })
          }
        } else {
          const network = this.#networks.networks.find((n) => n.chainId === meta.chainId)
          // Even without an initialized SignAccountOpController or Screen, we should still update the portfolio and run the simulation.
          // It's necessary to continue operating with the token `amountPostSimulation` amount.
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.#updateSelectedAccountPortfolio(network ? [network] : undefined)
        }
      } else if (req.kind === 'typedMessage' || req.kind === 'message') {
        const existingMessageRequest = this.userRequests.find(
          (r) => r.kind === req.kind && r.meta.accountAddr === req.meta.accountAddr
        ) as PlainTextMessageUserRequest | TypedMessageUserRequest | undefined

        if (existingMessageRequest) {
          await this.rejectUserRequests('User rejected the message request', [
            existingMessageRequest.id
          ])
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
      this.currentUserRequest = null
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

  async #awaitPendingPromises() {
    await this.requestWindow.closeWindowPromise
    await this.requestWindow.focusWindowPromise
    await this.requestWindow.openWindowPromise
  }

  async #setCurrentUserRequest(nextRequest: UserRequest | null, params?: OpenRequestWindowParams) {
    this.currentUserRequest = nextRequest
    this.emitUpdate()

    if (nextRequest) {
      await this.openRequestWindow(params)
      return
    }

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

      if (this.currentUserRequest?.kind === 'swapAndBridge') {
        customSize = SWAP_AND_BRIDGE_WINDOW_SIZE
      }

      try {
        await this.#ui.window.remove('popup')
        this.requestWindow.openWindowPromise = this.#ui.window
          .open({ customSize, baseWindowId })
          .finally(() => {
            this.requestWindow.openWindowPromise = undefined
          })
        this.requestWindow.windowProps = await this.requestWindow.openWindowPromise

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
      await this.#ui.window.remove('popup')
      this.requestWindow.focusWindowPromise = this.#ui.window
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

  async closeRequestWindow() {
    await this.#awaitPendingPromises()

    if (!this.requestWindow.windowProps) return

    this.requestWindow.closeWindowPromise = this.#ui.window
      .remove(this.requestWindow.windowProps.id)
      .finally(() => {
        this.requestWindow.closeWindowPromise = undefined
      })

    await this.requestWindow.closeWindowPromise

    if (!this.requestWindow.windowProps) return

    await this.#handleRequestWindowClose(this.requestWindow.windowProps.id)
  }

  async #handleRequestWindowClose(winId: number) {
    if (
      winId === this.requestWindow.windowProps?.id ||
      (!this.visibleUserRequests.length &&
        this.currentUserRequest &&
        this.requestWindow.windowProps)
    ) {
      this.requestWindow.windowProps = null
      this.requestWindow.loaded = false
      this.requestWindow.pendingMessage = null
      this.currentUserRequest = null

      const callsCount = this.userRequests.reduce((acc, request) => {
        if (request.kind !== 'calls') return acc

        return acc + (request.accountOp.calls?.length || 0)
      }, 0)

      if (this.visibleUserRequests.length) {
        await this.#ui.notification.create({
          title: callsCount > 1 ? `${callsCount} transactions queued` : 'Transaction queued',
          message: 'Queued pending transactions are available on your Dashboard.'
        })
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const r of this.userRequests) {
        if (r.kind === 'walletAddEthereumChain') {
          const chainId = r.meta.params[0].chainId
          // eslint-disable-next-line no-continue
          if (!chainId) continue

          const network = this.#networks.networks.find((n) => n.chainId === BigInt(chainId))
          if (network && !network.disabled) await this.resolveUserRequest(null, r.id)
        }
      }

      const userRequestsToRejectOnWindowClose = this.userRequests.filter((r) => r.kind !== 'calls')
      await this.rejectUserRequests(
        ethErrors.provider.userRejectedRequest().message,
        userRequestsToRejectOnWindowClose.map((r) => r.id),
        // If the user closes a window and non-calls user requests exist,
        // the window will reopen with the next request.
        // For example: if the user has both a sign message and sign account op request,
        // closing the window will reject the sign message request but immediately
        // reopen the window for the sign account op request.
        { shouldOpenNextRequest: false }
      )

      this.userRequestsWaitingAccountSwitch = []
      this.emitUpdate()
    }
  }

  async onSignAccountOpUpdate(accountOp: AccountOp) {
    const { accountAddr, chainId } = accountOp

    const request = this.userRequests.find(
      (r) => r.kind === 'calls' && r.id === `${accountAddr}-${chainId}`
    ) as CallsUserRequest | undefined

    if (!request) return
    // The RequestsController is responsible for managing the calls array of each request.
    // When a signAccountOp update arrives, only the *non-call* fields of accountOp should
    // be applied to the existing userRequest. The calls themselves must remain unchanged
    // and continue to be managed exclusively by the controller.
    const { calls, ...rest } = accountOp

    Object.assign(request.accountOp, rest)
    this.emitUpdate()
  }

  async rejectCalls({
    callIds = [],
    activeRouteIds = [],
    errorMessage = 'User rejected the transaction request!'
  }: {
    callIds?: Call['id'][]
    activeRouteIds?: string[]
    errorMessage?: string
  }) {
    if (!callIds.length && !activeRouteIds.length) return

    const findRequestByCall = (predicate: (c: Call) => boolean) =>
      this.userRequests.find((r) => r.kind === 'calls' && r.accountOp.calls.some(predicate)) as
        | CallsUserRequest
        | undefined

    const rejectAndCleanup = async (request: CallsUserRequest, callIdsToRemove: Call['id'][]) => {
      request.accountOp.calls = request.accountOp.calls.filter((c) => {
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

      const signAccountOp = this.#getSignAccountOp()

      if (signAccountOp && signAccountOp.fromRequestId === request.id) {
        signAccountOp.update({ accountOpData: { calls: request.accountOp.calls } })
      }

      if (!request.accountOp.calls.length) {
        await this.rejectUserRequests('User rejected the transaction request.', [request.id], {
          shouldOpenNextRequest: true
        })
      } else {
        this.emitUpdate()
      }
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const callId of callIds) {
      const request = findRequestByCall((c) => c.id === callId)
      // eslint-disable-next-line no-continue
      if (!request) continue

      const call = request.accountOp.calls.find((c) => c.id === callId)

      // eslint-disable-next-line no-continue
      if (!call) continue

      const idsToRemove = call.activeRouteId
        ? [
            call.activeRouteId,
            `${call.activeRouteId}-approval`,
            `${call.activeRouteId}-revoke-approval`
          ]
        : [call.id]

      await rejectAndCleanup(request, idsToRemove)
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const activeRouteId of activeRouteIds) {
      const request = findRequestByCall((c) => c.activeRouteId === activeRouteId)
      // eslint-disable-next-line no-continue
      if (!request) continue

      const callIdsToRemove = request.accountOp.calls
        .filter((c) => c.activeRouteId === activeRouteId)
        .map((c) => c.id)
        .filter(Boolean) as string[]

      // eslint-disable-next-line no-continue
      if (callIdsToRemove.length === 0) continue

      await rejectAndCleanup(request, callIdsToRemove)
    }
  }

  async removeUserRequests(
    ids: UserRequest['id'][],
    options?: {
      shouldRemoveSwapAndBridgeRoute?: boolean
      shouldUpdateAccount?: boolean
      shouldOpenNextRequest?: boolean
    }
  ) {
    const {
      shouldRemoveSwapAndBridgeRoute = true,
      shouldUpdateAccount = true,
      shouldOpenNextRequest = true
    } = options || {}

    const userRequestsToAdd: UserRequest[] = []

    ids.forEach((id) => {
      const req = this.userRequests.find((uReq) => uReq.id === id)

      if (!req) return

      // remove from the request queue
      this.userRequests.splice(this.userRequests.indexOf(req), 1)

      // update the pending stuff to be signed
      const { kind, meta } = req
      if (kind === 'calls') {
        const network = this.#networks.networks.find((net) => net.chainId === meta.chainId)!
        const account = this.#accounts.accounts.find((x) => x.addr === meta.accountAddr)
        if (!account)
          throw new Error(
            `batchCallsFromUserRequests: tried to run for non-existent account ${meta.accountAddr}`
          )

        if (shouldUpdateAccount)
          this.#updateSelectedAccountPortfolio(network ? [network] : undefined)

        if (this.#swapAndBridge.activeRoutes.length && shouldRemoveSwapAndBridgeRoute) {
          req.accountOp.calls.forEach((c) => {
            if (c.activeRouteId) this.#swapAndBridge.removeActiveRoute(c.activeRouteId)
          })
        }

        const signAccountOp = this.#getSignAccountOp()

        if (signAccountOp && signAccountOp.fromRequestId === req.id) {
          this.#destroySignAccountOp()
        }
        return
      }
      if (kind === 'switchAccount') {
        const requestsToAddOrRemove = this.userRequestsWaitingAccountSwitch.filter(
          (r) =>
            isSignRequest(r.kind) &&
            (r as SignUserRequest).meta.accountAddr === this.#selectedAccount.account?.addr
        )

        requestsToAddOrRemove.forEach((r) => {
          this.userRequestsWaitingAccountSwitch.splice(this.userRequests.indexOf(r), 1)
          userRequestsToAdd.push(r)
        })
      }
    })

    if (userRequestsToAdd.length) {
      await this.addUserRequests(userRequestsToAdd, { skipFocus: true })
    }

    if (!this.visibleUserRequests.length) {
      await this.#setCurrentUserRequest(null)
    } else if (shouldOpenNextRequest) {
      await this.#setCurrentUserRequest(this.visibleUserRequests[0] || null, {
        skipFocus: true
      })
    } else {
      this.emitUpdate()
    }
  }

  async resolveUserRequest(data: any, requestId: UserRequest['id']) {
    const userRequest = this.userRequests.find((r) => r.id === requestId)
    if (!userRequest) return // TODO: emit error

    const { kind, meta, dappPromises } = userRequest

    dappPromises.forEach((p) => {
      p.resolve(data)
    })

    // These requests are transitionary initiated internally (not dApp requests) that block dApp requests
    // before being resolved. The timeout prevents the request-window from closing before the actual dApp request arrives
    if (kind === 'unlock' || kind === 'dappConnect' || kind === 'switchAccount') {
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

  async rejectUserRequests(
    err: string,
    requestIds: UserRequest['id'][],
    options?: {
      shouldRemoveSwapAndBridgeRoute?: boolean
      shouldOpenNextRequest?: boolean
    }
  ) {
    this.userRequests
      .filter((r) => requestIds.includes(r.id))
      .forEach((r) =>
        r.dappPromises.forEach((p) => p.reject(ethErrors.provider.userRejectedRequest<any>(err)))
      )

    await this.removeUserRequests(requestIds, options)
  }

  async build({ type, params }: BuildRequest) {
    await this.initialLoadPromise

    if (type === 'dappRequest') {
      try {
        await this.#buildUserRequestFromDAppRequest(params.request, params.dappPromise)
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
      const { userRequestParams, ...rest } = params
      const userRequest = await this.#createCallsUserRequest(userRequestParams)
      await this.addUserRequests([userRequest], { ...rest })
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
  }

  async #buildUserRequestFromDAppRequest(
    request: DappProviderRequest,
    dappPromise: {
      id: string
      session: DappProviderRequest['session']
      resolve: (data: any) => void
      reject: (data: any) => void
    }
  ) {
    await this.initialLoadPromise
    await this.#guardHWSigning(true)

    let userRequest: UserRequest | null = null
    let position: RequestPosition = 'last'
    const kind = dappRequestMethodToRequestKind(request.method)
    const dapp = (await this.#getDapp(request.session.id)) || null

    if (kind === 'calls') {
      if (!this.#selectedAccount.account) throw ethErrors.rpc.internal()
      const network = this.#networks.networks.find(
        (n) => Number(n.chainId) === Number(dapp?.chainId)
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
        this.#keystore.getAccountKeys(this.#selectedAccount.account),
        network
      )

      const isWalletSendCalls = !!request.params[0].calls
      const accountAddr = getAddress(request.params[0].from)

      if (isWalletSendCalls && !request.params[0].calls.length)
        throw ethErrors.provider.unsupportedMethod({
          message: 'Request rejected - empty calls array not allowed!'
        })

      let calls: AccountOp['calls'] = isWalletSendCalls
        ? request.params[0].calls
        : [request.params[0]]

      calls = calls.map((c) => ({
        ...c,
        data: c.data || '0x',
        value: c.value ? getBigInt(c.value) : 0n,
        dapp: dapp ?? undefined,
        dappPromiseId: dappPromise.id
      }))
      const paymasterService =
        isWalletSendCalls && !!request.params[0].capabilities?.paymasterService
          ? getPaymasterService(network.chainId, request.params[0].capabilities)
          : getAmbirePaymasterService(baseAcc, this.#relayerUrl)

      const atomicRequired = isWalletSendCalls && !!request.params[0].atomicRequired
      if (isWalletSendCalls && atomicRequired && baseAcc.getAtomicStatus() === 'unsupported') {
        throw ethErrors.provider.custom({
          code: 5700,
          message: 'Transaction failed - atomicity is not supported for this account'
        })
      }

      const walletSendCallsVersion = isWalletSendCalls
        ? request.params[0].version ?? '1.0.0'
        : undefined

      userRequest = await this.#createCallsUserRequest({
        calls,
        meta: {
          accountAddr,
          chainId: network.chainId,
          walletSendCallsVersion,
          paymasterService
        },
        dappPromises: [{ ...dappPromise, meta: { isWalletSendCalls } }]
      })
    } else if (kind === 'message') {
      if (!this.#selectedAccount.account) throw ethErrors.rpc.internal()

      const msg = request.params
      if (!msg) {
        throw ethErrors.rpc.invalidRequest('No msg request to sign')
      }
      const msgAddress = getAddress(msg?.[1])

      const network = this.#networks.networks.find(
        (n) => Number(n.chainId) === Number(dapp?.chainId)
      )

      if (!network) {
        throw ethErrors.provider.chainDisconnected('Transaction failed - unknown network')
      }

      userRequest = {
        id: new Date().getTime(),
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
      if (rawMessage && parsedSiweAndStatus) {
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
              return
            }
          } catch (e: any) {
            this.emitError({
              error: e,
              message: 'Auto-login failed. Please sign the message manually.',
              level: 'major'
            })
          }
        }

        userRequest = {
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
    } else if (kind === 'typedMessage') {
      if (!this.#selectedAccount.account) throw ethErrors.rpc.internal()

      const msg = request.params
      if (!msg) {
        throw ethErrors.rpc.invalidRequest('No msg request to sign')
      }
      const msgAddress = getAddress(msg?.[0])

      const network = this.#networks.networks.find(
        (n) => Number(n.chainId) === Number(dapp?.chainId)
      )

      if (!network) {
        throw ethErrors.provider.chainDisconnected('Transaction failed - unknown network')
      }

      let typedData = msg?.[1]

      try {
        typedData = parse(typedData)
      } catch (error) {
        throw ethErrors.rpc.invalidRequest('Invalid typedData provided')
      }

      if (
        !typedData?.types ||
        !typedData?.domain ||
        !typedData?.message ||
        !typedData?.primaryType
      ) {
        throw ethErrors.rpc.methodNotSupported(
          'Invalid typedData format - only typedData v4 is supported'
        )
      }

      if (
        msgAddress === this.#selectedAccount.account.addr &&
        (typedData.primaryType === 'AmbireOperation' || !!typedData.types.AmbireOperation)
      ) {
        throw ethErrors.rpc.methodNotSupported('Signing an AmbireOperation is not allowed')
      }

      userRequest = {
        id: new Date().getTime(),
        kind: 'typedMessage',
        meta: {
          params: {
            types: typedData.types,
            domain: typedData.domain,
            message: typedData.message,
            primaryType: typedData.primaryType
          },
          accountAddr: msgAddress,
          chainId: network.chainId
        },
        dappPromises: [{ ...dappPromise, session: request.session, meta: {} }]
      } as TypedMessageUserRequest
    } else {
      userRequest = {
        id: new Date().getTime(),
        kind,
        meta: { params: request.params },
        dappPromises: [{ ...dappPromise, session: request.session, meta: {} }]
      }
    }

    if (!userRequest) return

    if (userRequest.kind !== 'calls') {
      const otherUserRequestFromSameDapp = this.userRequests.find((r) =>
        r.dappPromises.some((p) =>
          userRequest.dappPromises
            .map((promise) => promise.session.origin)
            .includes(p.session.origin)
        )
      )

      if (!otherUserRequestFromSameDapp && !!dappPromise.session.origin) {
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

    const accountError = this.#getUserRequestAccountError(
      dappPromise.session.origin,
      (userRequest as SignUserRequest).meta.accountAddr
    )

    if (accountError) {
      dappPromise.reject(ethErrors.provider.userRejectedRequest(accountError))
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
      this.#keystore.getAccountKeys(this.#selectedAccount.account),
      this.#networks.networks.find((net) => net.chainId === selectedToken.chainId)!
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

    const userRequest = await this.#createCallsUserRequest({ ...requestParams, dappPromises: [] })
    await this.addUserRequests([userRequest], { executionType, position: 'last' })
  }

  async #buildTransferUserRequest({
    amount,
    amountInFiat,
    recipientAddress,
    selectedToken,
    executionType = 'open-request-window'
  }: {
    amount: string
    amountInFiat: bigint
    recipientAddress: string
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
      this.#keystore.getAccountKeys(this.#selectedAccount.account),
      this.#networks.networks.find((net) => net.chainId === selectedToken.chainId)!
    )

    const callsRequestParams = getTransferRequestParams({
      selectedAccount: this.#selectedAccount.account.addr,
      amount,
      amountInFiat,
      selectedToken,
      recipientAddress,
      paymasterService: getAmbirePaymasterService(baseAcc, this.#relayerUrl)
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

    const userRequest = await this.#createCallsUserRequest(callsRequestParams)
    await this.addUserRequests([userRequest], { position: 'last', executionType })
    this.#transfer.resetForm() // reset the transfer form after adding a req
  }

  async #buildSwapAndBridgeUserRequest({
    openActionWindow,
    activeRouteId
  }: {
    openActionWindow: boolean
    activeRouteId?: SwapAndBridgeActiveRoute['activeRouteId']
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
          this.#keystore.getAccountKeys(this.#selectedAccount.account),
          network
        )
        const swapAndBridgeRequestParams = await getSwapAndBridgeRequestParams(
          transaction,
          network.chainId,
          this.#selectedAccount.account,
          this.#providers.providers[network.chainId.toString()],
          accountState,
          getAmbirePaymasterService(baseAcc, this.#relayerUrl)
        )

        const userRequest = await this.#createCallsUserRequest(swapAndBridgeRequestParams)
        await this.addUserRequests([userRequest], {
          position: 'last',
          executionType: openActionWindow ? 'open-request-window' : 'queue'
        })

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
    const userRequest = await this.#createCallsUserRequest(userRequestParams)
    await this.addUserRequests([userRequest])
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
    const userRequest = await this.#createCallsUserRequest(userRequestParams)
    await this.addUserRequests([userRequest])
  }

  #getUserRequestAccountError(dappOrigin: string, fromAccountAddr: string): string | null {
    if (ORIGINS_WHITELISTED_TO_ALL_ACCOUNTS.includes(dappOrigin)) {
      const isAddressInAccounts = this.#accounts.accounts.some((a) => a.addr === fromAccountAddr)

      if (isAddressInAccounts) return null

      return 'The dApp is trying to sign using an address that is not imported in the extension.'
    }
    const isAddressSelected = this.#selectedAccount.account?.addr === fromAccountAddr

    if (isAddressSelected) return null

    return 'The dApp is trying to sign using an address that is not selected in the extension.'
  }

  async #addSwitchAccountUserRequest(req: SignUserRequest) {
    this.userRequestsWaitingAccountSwitch.push(req)
    await this.addUserRequests(
      [
        buildSwitchAccountUserRequest({
          nextUserRequest: req,
          selectedAccountAddr: req.meta.accountAddr,
          dappPromises: req.dappPromises
        })
      ],
      {
        position: 'last',
        executionType: 'open-request-window'
      }
    )
  }

  // ! IMPORTANT !
  // Banners that depend on async data from sub-controllers should be implemented
  // in the sub-controllers themselves. This is because updates in the sub-controllers
  // will not trigger emitUpdate in the MainController, therefore the banners will
  // remain the same until a subsequent update in the MainController.
  get banners(): Banner[] {
    if (!this.#selectedAccount.account || !this.#networks.isInitialized) return []

    const activeSwapAndBridgeRoutesForSelectedAccount = getActiveRoutesForAccount(
      this.#selectedAccount.account.addr,
      this.#swapAndBridge.activeRoutes
    )
    const swapAndBridgeRoutesPendingSignature = activeSwapAndBridgeRoutesForSelectedAccount.filter(
      (r) => r.routeStatus === 'ready'
    )

    return [
      ...getAccountOpBanners({
        callsUserRequestsByNetwork: getCallsUserRequestsByNetwork(
          this.#selectedAccount.account.addr,
          this.userRequests
        ),
        selectedAccount: this.#selectedAccount.account.addr,
        networks: this.#networks.networks,
        swapAndBridgeRoutesPendingSignature
      }),
      ...getDappUserRequestsBanners(this.visibleUserRequests)
    ]
  }

  async #createOrUpdateCallsUserRequest({
    calls,
    meta,
    dappPromises = []
  }: {
    calls: Call[]
    meta: CallsUserRequest['meta']
    dappPromises?: CallsUserRequest['dappPromises']
  }) {
    let callUserRequest: CallsUserRequest | undefined
    const existingUserRequest = this.userRequests.find(
      (r) =>
        r.kind === 'calls' &&
        r.meta.accountAddr === meta.accountAddr &&
        r.meta.chainId === meta.chainId
    ) as CallsUserRequest | undefined

    if (existingUserRequest) {
      existingUserRequest.signAccountOp.update({
        accountOpData: {
          calls: [
            ...existingUserRequest.signAccountOp.accountOp.calls,
            ...calls.map((call) => ({
              ...call,
              id: uuidv4(),
              to: call.to,
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
      existingUserRequest.dappPromises = [...existingUserRequest.dappPromises, ...dappPromises]
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

      const network = this.#networks.networks.find((n) => n.chainId === meta.chainId)!

      const requestId = `${meta.accountAddr}-${meta.chainId}`
      callUserRequest = {
        id: requestId,
        kind: 'calls',
        meta,
        signAccountOp: new SignAccountOpController({
          callRelayer: this.#callRelayer,
          accounts: this.#accounts,
          networks: this.#networks,
          keystore: this.#keystore,
          portfolio: this.#portfolio,
          externalSignerControllers: this.#externalSignerControllers,
          activity: this.#activity,
          account,
          network,
          provider: this.#providers.providers[network.chainId.toString()]!,
          phishing: this.#phishing,
          fromRequestId: requestId,
          accountOp: {
            accountAddr: meta.accountAddr,
            chainId: meta.chainId,
            signingKeyAddr: null,
            signingKeyType: null,
            gasLimit: null,
            gasFeePayment: null,
            nonce: accountState.nonce,
            signature: account.associatedKeys[0]
              ? generateSpoofSig(account.associatedKeys[0])
              : null,
            calls: [
              ...calls.map((call) => ({
                ...call,
                id: uuidv4(),
                to: call.to,
                data: call.data || '0x',
                value: call.value ? getBigInt(call.value) : 0n
              }))
            ],
            meta
          },
          isSignRequestStillActive: () =>
            this.currentUserRequest && this.currentUserRequest.id === requestId,
          shouldSimulate: true,
          onUpdateAfterTraceCallSuccess: async () => {
            const accountOpsForSimulation = getAccountOpsForSimulation(
              account,
              this.visibleUserRequests,
              this.#networks.networks
            )

            await this.#portfolio.updateSelectedAccount(
              account.addr,
              [network],
              accountOpsForSimulation
                ? {
                    accountOps: accountOpsForSimulation,
                    states: await this.#accounts.getOrFetchAccountStates(account.addr)
                  }
                : undefined
            )
          },
          onBroadcastSuccess: this.#onBroadcastSuccess,
          onBroadcastFailed: this.#onBroadcastFailed
        }),

        dappPromises
      } as CallsUserRequest
    }

    return callUserRequest
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
        return r.accountOp.accountAddr !== address
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

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      banners: this.banners,
      visibleUserRequests: this.visibleUserRequests,
      currentUserRequest: this.currentUserRequest
    }
  }
}
