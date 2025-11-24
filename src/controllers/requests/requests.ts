/* eslint-disable no-await-in-loop */
import { ethErrors } from 'eth-rpc-errors'
import { getAddress, getBigInt } from 'ethers'

import EmittableError from '../../classes/EmittableError'
import { Session } from '../../classes/session'
import SwapAndBridgeError from '../../classes/SwapAndBridgeError'
import { ORIGINS_WHITELISTED_TO_ALL_ACCOUNTS } from '../../consts/dappCommunication'
import { AccountId, AccountOnchainState, IAccountsController } from '../../interfaces/account'
import {
  AccountOpAction,
  Action,
  ActionExecutionType,
  ActionPosition
} from '../../interfaces/actions'
import { AutoLoginStatus, IAutoLoginController } from '../../interfaces/autoLogin'
import { Banner } from '../../interfaces/banner'
import { Dapp, DappProviderRequest } from '../../interfaces/dapp'
import { Statuses } from '../../interfaces/eventEmitter'
import { IKeystoreController } from '../../interfaces/keystore'
import { StatusesWithCustom } from '../../interfaces/main'
import { INetworksController, Network } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { BuildRequest, IRequestsController } from '../../interfaces/requests'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { ISignAccountOpController } from '../../interfaces/signAccountOp'
import {
  ISwapAndBridgeController,
  SwapAndBridgeActiveRoute,
  SwapAndBridgeSendTxRequest
} from '../../interfaces/swapAndBridge'
import { ITransactionManagerController } from '../../interfaces/transactionManager'
import { ITransferController } from '../../interfaces/transfer'
import { IUiController, WindowProps } from '../../interfaces/ui'
import {
  CallsUserRequest,
  PlainTextMessageUserRequest,
  TypedMessageUserRequest,
  UserRequest
} from '../../interfaces/userRequest'
import { isBasicAccount, isSmartAccount } from '../../libs/account/account'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { Call } from '../../libs/accountOp/types'
import {
  dappRequestMethodToActionKind,
  getAccountOpActionsByNetwork
} from '../../libs/actions/actions'
import { getAccountOpBanners } from '../../libs/banners/banners'
import { getAmbirePaymasterService, getPaymasterService } from '../../libs/erc7677/erc7677'
import { TokenResult } from '../../libs/portfolio'
import { PortfolioRewardsResult } from '../../libs/portfolio/interfaces'
import {
  ACCOUNT_SWITCH_USER_REQUEST,
  buildSwitchAccountUserRequest
} from '../../libs/requests/requests'
import { parse } from '../../libs/richJson/richJson'
import {
  buildSwapAndBridgeUserRequests,
  getActiveRoutesForAccount
} from '../../libs/swapAndBridge/swapAndBridge'
import {
  buildClaimWalletRequest,
  buildMintVestingRequest,
  buildTransferUserRequest,
  prepareIntentUserRequest
} from '../../libs/transfer/userRequest'
import generateSpoofSig from '../../utils/generateSpoofSig'
import { AutoLoginController } from '../autoLogin/autoLogin'
import EventEmitter from '../eventEmitter/eventEmitter'
import { SignAccountOpUpdateProps } from '../signAccountOp/signAccountOp'
import { SwapAndBridgeFormStatus } from '../swapAndBridge/swapAndBridge'

const STATUS_WRAPPED_METHODS = {
  buildSwapAndBridgeUserRequest: 'INITIAL'
} as const

/**
 * The RequestsController is responsible for building different user request types and managing their associated actions (within an action window).
 * Prior to v2.66.0, all request logic resided in the MainController. To improve scalability, readability,
 * and testability, this logic was encapsulated in this dedicated controller.
 */
export class RequestsController extends EventEmitter implements IRequestsController {
  #relayerUrl: string

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

  #getSignAccountOp: () => ISignAccountOpController | null

  #getMainStatuses: () => StatusesWithCustom

  #updateSignAccountOp: (props: SignAccountOpUpdateProps) => void

  #destroySignAccountOp: () => void

  #updateSelectedAccountPortfolio: (networks?: Network[]) => Promise<void>

  #addTokensToBeLearned: (tokenAddresses: string[], chainId: bigint) => void

  #guardHWSigning: (throwRpcError: boolean) => Promise<boolean>

  #onSetCurrentAction: (currentAction: Action | null) => void

  userRequests: UserRequest[] = []

  userRequestsWaitingAccountSwitch: UserRequest[] = []

  userRequestWindow: {
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

  currentUserRequest: UserRequest | null = null

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor({
    relayerUrl,
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
    getSignAccountOp,
    updateSignAccountOp,
    destroySignAccountOp,
    updateSelectedAccountPortfolio,
    addTokensToBeLearned,
    guardHWSigning,
    getMainStatuses,
    onSetCurrentAction
  }: {
    relayerUrl: string
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
    getSignAccountOp: () => ISignAccountOpController | null
    updateSignAccountOp: (props: SignAccountOpUpdateProps) => void
    destroySignAccountOp: () => void
    updateSelectedAccountPortfolio: (networks?: Network[]) => Promise<void>
    addTokensToBeLearned: (tokenAddresses: string[], chainId: bigint) => void
    guardHWSigning: (throwRpcError: boolean) => Promise<boolean>
    getMainStatuses: () => StatusesWithCustom
    onSetCurrentAction: (currentAction: Action | null) => void
  }) {
    super()

    this.#relayerUrl = relayerUrl
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
    this.#getSignAccountOp = getSignAccountOp
    this.#getMainStatuses = getMainStatuses
    this.#updateSignAccountOp = updateSignAccountOp
    this.#destroySignAccountOp = destroySignAccountOp
    this.#updateSelectedAccountPortfolio = updateSelectedAccountPortfolio
    this.#addTokensToBeLearned = addTokensToBeLearned
    this.#guardHWSigning = guardHWSigning
    this.#onSetCurrentAction = onSetCurrentAction

    // this.actions = new ActionsController({
    //   selectedAccount: this.#selectedAccount,
    //   ui,
    //   onSetCurrentAction: this.#onSetCurrentAction,
    //   onActionWindowClose: async () => {
    //     // eslint-disable-next-line no-restricted-syntax
    //     for (const r of this.userRequests) {
    //       if (r.action.kind === 'walletAddEthereumChain') {
    //         const chainId = r.action.params?.[0]?.chainId
    //         // eslint-disable-next-line no-continue
    //         if (!chainId) continue

    //         const network = this.#networks.networks.find((n) => n.chainId === BigInt(chainId))
    //         if (network && !network.disabled) {
    //           await this.resolveUserRequest(null, r.id)
    //         }
    //       }
    //     }

    //     const userRequestsToRejectOnWindowClose = this.userRequests.filter(
    //       (r) => r.action.kind !== 'calls'
    //     )
    //     await this.rejectUserRequests(
    //       ethErrors.provider.userRejectedRequest().message,
    //       userRequestsToRejectOnWindowClose.map((r) => r.id),
    //       // If the user closes a window and non-calls user requests exist,
    //       // the window will reopen with the next request.
    //       // For example: if the user has both a sign message and sign account op request,
    //       // closing the window will reject the sign message request but immediately
    //       // reopen the window for the sign account op request.
    //       { shouldOpenNextRequest: false }
    //     )

    //     this.userRequestsWaitingAccountSwitch = []
    //     this.emitUpdate()
    //   }
    // })

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
        return r.accountOp.accountAddr === this.#selectedAccount.account?.addr
      }
      if (
        r.kind === 'typedMessage' ||
        r.kind === 'message' ||
        r.kind === 'authorization-7702' ||
        r.kind === 'siwe'
      ) {
        return r.meta.accountAddr === this.#selectedAccount.account?.addr
      }
      if (r.kind === 'benzin') {
        return r.meta.accountAddr === this.#selectedAccount.account?.addr
      }
      if (r.kind === 'switchAccount') {
        return r.meta.switchToAccountAddr !== this.#selectedAccount.account?.addr
      }
      // TODO:
      // if (a.type === 'swapAndBridge' || a.type === 'transfer') {
      //   return a.userRequest.meta.accountAddr === this.#selectedAccount.account?.addr
      // }

      return true
    })
  }

  async addUserRequests(
    reqs: UserRequest[],
    {
      position = 'last',
      executionType = 'open-action-window',
      allowAccountSwitch = false,
      skipFocus = false
    }: {
      position?: ActionPosition
      executionType?: ActionExecutionType
      allowAccountSwitch?: boolean
      skipFocus?: boolean
    } = {}
  ) {
    await this.initialLoadPromise
    const shouldSkipAddUserRequest = await this.#guardHWSigning(false)

    if (shouldSkipAddUserRequest) return

    let baseWindowId: number | undefined

    const userRequestsToAdd = []

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
      if (allowAccountSwitch && req.meta.accountAddr !== this.#selectedAccount.account?.addr) {
        await this.#addSwitchAccountUserRequest(req)
        return
      }

      if (req.kind === 'calls') {
        // Prevent adding a new request if a signing or broadcasting process is already in progress for the same account and chain.
        //
        // Why? When a transaction is being signed and broadcast, its action is still unresolved.
        // If a new request is added during this time, it gets incorrectly attached to the ongoing action.
        // Once the transaction is broadcast, the action resolves,
        // leaving the new request "orphaned" in the background with no banner shown on the Dashboard.
        // The next time the user starts a transaction, both requests appear in the batch, which is confusing.
        // To avoid this, we block new requests until the current process is complete.
        //
        //  Main issue: https://github.com/AmbireTech/ambire-app/issues/4771
        if (
          signStatus === 'LOADING' &&
          signAccountOpController?.accountOp.accountAddr === req.meta.accountAddr &&
          signAccountOpController?.accountOp.chainId === req.meta.chainId
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

            if (req.dappPromises) {
              req.dappPromises.forEach((p) => {
                p.reject(
                  ethErrors.rpc.transactionRejected({
                    message: errorMessage
                  })
                )
              })

              await this.#ui.notification.create({
                title: 'Rejected!',
                message: errorMessage
              })
            }

            hasTxInProgressErrorShown = true
          }

          return
        }
      }

      if (req.kind === 'calls') {
        req.accountOp.calls.forEach((_, i) => {
          req.accountOp.calls[i].id = `${req.id}-${i}`
        })
      }

      const { kind, meta } = req
      if (kind === 'calls') {
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

          if (req.dappPromises) {
            req.dappPromises[0]?.reject(ethErrors.rpc.internal())
            await this.#ui.notification.create({ title: "Couldn't Process Request", message })
          }

          return
        }

        const userRequestToAdd = await this.#addOrUpdateCallsUserRequest(
          req.accountOp.calls,
          req.meta,
          req.dappPromises
        )

        if (userRequestToAdd) userRequestsToAdd.push(userRequestToAdd)
      } else if (req.kind === 'typedMessage' || req.kind === 'message') {
        const existingMessageRequest = this.userRequests.find(
          (r) =>
            (r.kind === 'typedMessage' || r.kind === 'message') &&
            r.meta.accountAddr === req.meta.accountAddr
        ) as PlainTextMessageUserRequest | TypedMessageUserRequest | undefined

        if (existingMessageRequest) {
          existingMessageRequest.dappPromises.forEach((p) => {
            p.reject(
              ethErrors.provider.custom({
                code: 1001,
                message:
                  'Rejected: Please complete your pending message request before initiating a new one.'
              })
            )
          })
          return
        }

        userRequestsToAdd.push(req)
      }

      userRequestsToAdd.push(req)
    }

    this.userRequests = this.userRequests.filter((r) => {
      if (r.kind === 'benzin') return false

      if (r.kind === 'switchAccount') {
        return r.meta.switchToAccountAddr !== this.#selectedAccount.account?.addr
      }

      return true
    })

    if (this.currentUserRequest && this.currentUserRequest.kind === 'benzin') {
      this.currentUserRequest = null
    }

    userRequestsToAdd.forEach((newReq) => {
      const existingIndex = this.userRequests.findIndex((r) => r.id === newReq.id)

      if (existingIndex !== -1) {
        this.userRequests[existingIndex] = newReq
        if (executionType === 'open-action-window') {
          // this.sendNewActionMessage(newAction, 'updated')
        } else if (executionType === 'queue-but-open-action-window') {
          // this.sendNewActionMessage(newAction, 'queued')
        }
      } else if (position === 'first') {
        this.userRequests.unshift(newReq)
      } else {
        this.userRequests.push(newReq)
      }
    })

    const nextRequest = userRequestsToAdd[0]

    if (executionType !== 'queue') {
      let currentUserRequest = null
      if (executionType === 'open-action-window') {
        currentUserRequest = this.visibleUserRequests.find((r) => r.id === nextRequest.id) || null
      } else if (executionType === 'queue-but-open-action-window') {
        // this.sendNewActionMessage(nextAction, 'queued')
        currentUserRequest = this.currentUserRequest || this.visibleUserRequests[0] || null
      }
      await this.#setCurrentAction(currentUserRequest, {
        skipFocus,
        baseWindowId
      })
    } else {
      this.emitUpdate()
    }
  }

  async #setCurrentAction(nextAction: Action | null, params?: OpenActionWindowParams) {
    this.currentAction = nextAction
    this.emitUpdate()

    if (nextAction) {
      await this.openActionWindow(params)
      return
    }

    await this.closeActionWindow()
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

    const actionsToAddOrUpdate: Action[] = []
    const userRequestsToAdd: UserRequest[] = []
    const actionsToRemove: string[] = []

    ids.forEach((id) => {
      const req = this.userRequests.find((uReq) => uReq.id === id)

      if (!req) return

      // remove from the request queue
      this.userRequests.splice(this.userRequests.indexOf(req), 1)

      // update the pending stuff to be signed
      const { action, meta } = req
      if (action.kind === 'calls') {
        const network = this.#networks.networks.find((net) => net.chainId === meta.chainId)!
        const account = this.#accounts.accounts.find((x) => x.addr === meta.accountAddr)
        if (!account)
          throw new Error(
            `batchCallsFromUserRequests: tried to run for non-existent account ${meta.accountAddr}`
          )

        const accountOpIndex = this.actions.actionsQueue.findIndex(
          (a) => a.type === 'accountOp' && a.id === `${meta.accountAddr}-${meta.chainId}`
        )
        const accountOpAction = this.actions.actionsQueue[accountOpIndex] as
          | AccountOpAction
          | undefined
        // accountOp has just been rejected or broadcasted
        if (!accountOpAction) {
          if (shouldUpdateAccount)
            this.#updateSelectedAccountPortfolio(network ? [network] : undefined)

          if (this.#swapAndBridge.activeRoutes.length && shouldRemoveSwapAndBridgeRoute) {
            this.#swapAndBridge.removeActiveRoute(meta.activeRouteId)
          }
          return
        }
        const newCalls = this.#batchCallsFromUserRequests(meta.accountAddr, meta.chainId)
        const signAccountOp = this.#getSignAccountOp()
        if (newCalls.length) {
          actionsToAddOrUpdate.push({
            ...accountOpAction,
            accountOp: { ...accountOpAction.accountOp, calls: newCalls }
          })

          if (signAccountOp && signAccountOp.fromActionId === accountOpAction.id) {
            this.#updateSignAccountOp({ accountOpData: { calls: newCalls } })
          }
        } else {
          if (signAccountOp && signAccountOp.fromActionId === accountOpAction.id) {
            this.#destroySignAccountOp()
          }
          actionsToRemove.push(`${meta.accountAddr}-${meta.chainId}`)
          if (shouldUpdateAccount)
            this.#updateSelectedAccountPortfolio(network ? [network] : undefined)
        }
        if (this.#swapAndBridge.activeRoutes.length && shouldRemoveSwapAndBridgeRoute) {
          this.#swapAndBridge.removeActiveRoute(meta.activeRouteId)
        }
      } else if (id === ACCOUNT_SWITCH_USER_REQUEST) {
        const requestsToAddOrRemove = this.userRequestsWaitingAccountSwitch.filter(
          (r) => r.meta.accountAddr === this.#selectedAccount.account!.addr
        )
        const isSelectedAccountSwitched =
          this.#selectedAccount.account?.addr === (action as any).params!.switchToAccountAddr

        if (!isSelectedAccountSwitched) {
          actionsToRemove.push(id)
        } else {
          requestsToAddOrRemove.forEach((r) => {
            this.userRequestsWaitingAccountSwitch.splice(this.userRequests.indexOf(r), 1)
            userRequestsToAdd.push(r)
          })
        }
      } else {
        actionsToRemove.push(id as string)
      }
    })

    if (actionsToRemove.length) {
      await this.actions.removeActions(actionsToRemove, shouldOpenNextRequest)
    }
    if (userRequestsToAdd.length) {
      await this.addUserRequests(userRequestsToAdd, { skipFocus: true })
    }
    if (actionsToAddOrUpdate.length) {
      await this.actions.addOrUpdateActions(actionsToAddOrUpdate, {
        skipFocus: true
      })
    }

    this.emitUpdate()
  }

  async resolveUserRequest(data: any, requestId: UserRequest['id']) {
    const userRequest = this.userRequests.find((r) => r.id === requestId)
    if (!userRequest) return // TODO: emit error

    userRequest.dappPromise?.resolve(data)
    // These requests are transitionary initiated internally (not dApp requests) that block dApp requests
    // before being resolved. The timeout prevents the action-window from closing before the actual dApp request arrives
    if (['unlock', 'dappConnect'].includes(userRequest.action.kind)) {
      userRequest.meta.pendingToRemove = true

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
    const userRequestsToRemove: string[] = []

    requestIds.forEach((requestId) => {
      const userRequest = this.userRequests.find((r) => r.id === requestId)
      if (!userRequest) return

      // if the userRequest that is about to be removed is an approval request
      // find and remove the associated pending transaction request if there is any
      // this is valid scenario for a swap & bridge txs with a BA
      if (userRequest.action.kind === 'calls') {
        const acc = this.#accounts.accounts.find((a) => a.addr === userRequest.meta.accountAddr)!

        if (
          isBasicAccount(acc, this.#accounts.accountStates[acc.addr][userRequest.meta.chainId]) &&
          userRequest.meta.isSwapAndBridgeCall
        ) {
          userRequestsToRemove.push(
            userRequest.meta.activeRouteId,
            `${userRequest.meta.activeRouteId}-approval`,
            `${userRequest.meta.activeRouteId}-revoke-approval`
          )
        }
      }

      userRequest.dappPromise?.reject(ethErrors.provider.userRejectedRequest<any>(err))
    })

    await this.removeUserRequests([...userRequestsToRemove, ...requestIds], options)
  }

  async build({ type, params }: BuildRequest) {
    await this.initialLoadPromise

    if (type === 'dappRequest') {
      await this.#buildUserRequestFromDAppRequest(params.request, params.dappPromise)
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
      session: DappProviderRequest['session']
      resolve: (data: any) => void
      reject: (data: any) => void
    }
  ) {
    await this.initialLoadPromise
    await this.#guardHWSigning(true)

    let userRequest = null
    let position: ActionPosition = 'last'
    const kind = dappRequestMethodToActionKind(request.method)
    const dapp = await this.#getDapp(request.session.id)

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

      const calls: AccountOp['calls'] = isWalletSendCalls
        ? request.params[0].calls
        : [request.params[0]]
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

      const callsUserRequests = this.userRequests.filter(
        (req): req is CallsUserRequest => req.kind === 'calls'
      )
      const existingUserRequest = callsUserRequests.find(
        (r) => r.accountOp.accountAddr === accountAddr && r.accountOp.chainId === network.chainId
      )

      userRequest = {
        id: new Date().getTime(),
        kind: 'calls',
        action: {
          kind,
          calls: calls.map((call) => ({
            to: call.to,
            data: call.data || '0x',
            value: call.value ? getBigInt(call.value) : 0n
          }))
        },
        session: new Session({ windowId: request.session.windowId }),
        meta: {
          dapp,
          isSignAction: true,
          isWalletSendCalls,
          walletSendCallsVersion,
          accountAddr,
          chainId: network.chainId,
          paymasterService
        },
        dappPromise
      } as CallsUserRequest
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
        action: {
          kind: 'message',
          message: msg[0]
        },
        session: request.session,
        meta: {
          isSignAction: true,
          accountAddr: msgAddress,
          chainId: network.chainId
        },
        dappPromise
      } as SignUserRequest

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

        userRequest.action = {
          kind: 'siwe',
          message: msg[0],
          parsedMessage: parsedSiwe,
          autoLoginStatus,
          siweValidityStatus: status,
          isAutoLoginEnabledByUser: this.#autoLogin.settings.enabled,
          autoLoginDuration: this.#autoLogin.settings.duration
        }
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
        action: {
          kind: 'typedMessage',
          types: typedData.types,
          domain: typedData.domain,
          message: typedData.message,
          primaryType: typedData.primaryType
        },
        session: request.session,
        meta: {
          isSignAction: true,
          accountAddr: msgAddress,
          chainId: network.chainId
        },
        dappPromise
      } as SignUserRequest
    } else {
      userRequest = {
        id: new Date().getTime(),
        session: request.session,
        action: { kind, params: request.params },
        meta: { isSignAction: false },
        dappPromise
      } as DappUserRequest
    }

    if (userRequest.action.kind !== 'calls') {
      const otherUserRequestFromSameDapp = this.userRequests.find(
        (r) => r.dappPromise?.session?.origin === dappPromise?.session?.origin
      )

      if (!otherUserRequestFromSameDapp && !!dappPromise?.session?.origin) {
        position = 'first'
      }
    }

    if (!userRequest) return

    const isASignOperationRequestedForAnotherAccount =
      userRequest.meta.isSignAction &&
      userRequest.meta.accountAddr !== this.#selectedAccount.account?.addr

    // We can simply add the user request if it's not a sign operation
    // for another account
    if (!isASignOperationRequestedForAnotherAccount) {
      await this.addUserRequests([userRequest], {
        position,
        executionType:
          position === 'first' || isSmartAccount(this.#selectedAccount.account)
            ? 'open-action-window'
            : 'queue-but-open-action-window'
      })
      return
    }

    const accountError = this.#getUserRequestAccountError(
      dappPromise.session.origin,
      userRequest.meta.accountAddr
    )

    if (accountError) {
      dappPromise.reject(ethErrors.provider.userRejectedRequest(accountError))
      return
    }

    await this.#addSwitchAccountUserRequest(userRequest)
  }

  async #buildIntentUserRequest({
    recipientAddress,
    selectedToken,
    executionType = 'open-action-window'
  }: {
    amount: string
    recipientAddress: string
    selectedToken: TokenResult
    executionType: ActionExecutionType
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

    const userRequests = prepareIntentUserRequest({
      selectedAccount: this.#selectedAccount.account.addr,
      selectedToken,
      recipientAddress,
      paymasterService: getAmbirePaymasterService(baseAcc, this.#relayerUrl),
      transactions: this.#transactionManager.intent?.transactions
    })

    if (!userRequests.length) {
      this.emitError({
        level: 'major',
        message: 'Unexpected error while building intent request',
        error: new Error(
          'buildUserRequestFromIntentRequest: bad parameters passed to buildIntentUserRequest'
        )
      })
      return
    }

    await this.addUserRequests(userRequests, { executionType, position: 'last' })
  }

  async #buildTransferUserRequest({
    amount,
    amountInFiat,
    recipientAddress,
    selectedToken,
    executionType = 'open-action-window',
    windowId
  }: {
    amount: string
    amountInFiat: bigint
    recipientAddress: string
    selectedToken: TokenResult
    // eslint-disable-next-line default-param-last
    executionType: ActionExecutionType
    windowId?: number
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
    const userRequest = buildTransferUserRequest({
      selectedAccount: this.#selectedAccount.account.addr,
      amount,
      amountInFiat,
      selectedToken,
      recipientAddress,
      paymasterService: getAmbirePaymasterService(baseAcc, this.#relayerUrl),
      windowId
    })

    if (!userRequest) {
      this.emitError({
        level: 'major',
        message: 'Unexpected error while building transfer request',
        error: new Error(
          'buildUserRequestFromTransferRequest: bad parameters passed to buildTransferUserRequest'
        )
      })
      return
    }

    await this.addUserRequests([userRequest], {
      position: 'last',
      executionType
    })

    // reset the transfer form after adding a req
    this.#transfer.resetForm()
  }

  async #buildSwapAndBridgeUserRequest({
    openActionWindow,
    activeRouteId,
    windowId
  }: {
    openActionWindow: boolean
    activeRouteId?: SwapAndBridgeActiveRoute['activeRouteId']
    windowId?: number
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
        const swapAndBridgeUserRequests = await buildSwapAndBridgeUserRequests(
          transaction,
          network.chainId,
          this.#selectedAccount.account,
          this.#providers.providers[network.chainId.toString()],
          accountState,
          getAmbirePaymasterService(baseAcc, this.#relayerUrl),
          windowId
        )
        await this.addUserRequests(swapAndBridgeUserRequests, {
          position: 'last',
          executionType: openActionWindow ? 'open-action-window' : 'queue'
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

  async #buildClaimWalletUserRequest({
    token,
    windowId
  }: {
    token: TokenResult
    windowId?: number
  }) {
    if (!this.#selectedAccount.account) return

    const claimableRewardsData = (
      this.#selectedAccount.portfolio.portfolioState.rewards?.result as PortfolioRewardsResult
    )?.claimableRewardsData

    if (!claimableRewardsData) return

    const userRequest: UserRequest = buildClaimWalletRequest({
      selectedAccount: this.#selectedAccount.account.addr,
      selectedToken: token,
      claimableRewardsData,
      windowId
    })

    await this.addUserRequests([userRequest])
  }

  async #buildMintVestingUserRequest({
    token,
    windowId
  }: {
    token: TokenResult
    windowId?: number
  }) {
    if (!this.#selectedAccount.account) return

    const addrVestingData = (
      this.#selectedAccount.portfolio.portfolioState.rewards?.result as PortfolioRewardsResult
    )?.addrVestingData

    if (!addrVestingData) return
    const userRequest: UserRequest = buildMintVestingRequest({
      selectedAccount: this.#selectedAccount.account.addr,
      selectedToken: token,
      addrVestingData,
      windowId
    })

    await this.addUserRequests([userRequest])
  }

  #batchCallsFromUserRequests(accountAddr: AccountId, chainId: bigint): Call[] {
    // Note: we use reduce instead of filter/map so that the compiler can deduce that we're checking .kind
    return (this.userRequests.filter((r) => r.action.kind === 'calls') as SignUserRequest[]).reduce(
      (uCalls: Call[], req) => {
        if (req.meta.chainId === chainId && req.meta.accountAddr === accountAddr) {
          const { calls } = req.action as Calls
          calls.map((call) => uCalls.push({ ...call, fromUserRequestId: req.id }))
        }
        return uCalls
      },
      []
    )
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

  async #addSwitchAccountUserRequest(req: UserRequest) {
    this.userRequestsWaitingAccountSwitch.push(req)
    await this.addUserRequests(
      [
        buildSwitchAccountUserRequest({
          nextUserRequest: req,
          selectedAccountAddr: req.meta.accountAddr,
          session: req.session || new Session(),
          dappPromise: req.dappPromise
        })
      ],
      {
        position: 'last',
        executionType: 'open-action-window'
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

    return getAccountOpBanners({
      accountOpActionsByNetwork: getAccountOpActionsByNetwork(
        this.#selectedAccount.account.addr,
        this.actions.actionsQueue
      ),
      selectedAccount: this.#selectedAccount.account.addr,
      networks: this.#networks.networks,
      swapAndBridgeRoutesPendingSignature
    })
  }

  async #addOrUpdateCallsUserRequest(
    calls: Call[],
    meta: CallsUserRequest['meta'],
    dappPromises: CallsUserRequest['dappPromises'] = []
  ) {
    const existingUserRequest = this.userRequests.find(
      (r) =>
        r.kind === 'calls' &&
        r.meta.accountAddr === meta.accountAddr &&
        r.meta.chainId === meta.chainId
    ) as CallsUserRequest | undefined

    if (existingUserRequest) {
      existingUserRequest.accountOp.calls = [
        ...existingUserRequest.accountOp.calls,
        ...calls.map((call) => ({
          to: call.to,
          data: call.data || '0x',
          value: call.value ? getBigInt(call.value) : 0n
        }))
      ].map((c, i) => ({ ...c, id: `${existingUserRequest.id}-${i}` }))
      existingUserRequest.accountOp.meta = { ...existingUserRequest.accountOp.meta, ...meta }
      if (dappPromises) {
        existingUserRequest.dappPromises = [...existingUserRequest.dappPromises, ...dappPromises]
      }

      const signAccountOp = this.#getSignAccountOp()
      if (signAccountOp) {
        if (
          signAccountOp.accountOp.accountAddr === meta.accountAddr &&
          signAccountOp.accountOp.chainId === meta.chainId
        ) {
          this.#updateSignAccountOp({
            accountOpData: { calls: existingUserRequest.accountOp.calls }
          })
        }
      }
      return undefined
    }

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

    const userRequest = {
      id: new Date().getTime(),
      kind: 'calls',
      meta,
      accountOp: {
        accountAddr: meta.accountAddr,
        chainId: meta.chainId,
        signingKeyAddr: null,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        nonce: accountState.nonce,
        signature: account.associatedKeys[0] ? generateSpoofSig(account.associatedKeys[0]) : null,
        calls: calls.map((call) => ({
          to: call.to,
          data: call.data || '0x',
          value: call.value ? getBigInt(call.value) : 0n
        })),
        meta
      },
      dappPromises
    } as CallsUserRequest

    const network = this.#networks.networks.find((n) => n.chainId === meta.chainId)
    // Even without an initialized SignAccountOpController or Screen, we should still update the portfolio and run the simulation.
    // It's necessary to continue operating with the token `amountPostSimulation` amount.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#updateSelectedAccountPortfolio(network ? [network] : undefined)

    return userRequest
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      banners: this.banners
    }
  }
}
