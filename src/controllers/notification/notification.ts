/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-shadow */
import { ethErrors } from 'eth-rpc-errors'
import { getBigInt } from 'ethers'

import { Account } from '../../interfaces/account'
import { Dapp } from '../../interfaces/dapp'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { CustomNetwork, NetworkPreference } from '../../interfaces/settings'
import { UserRequest } from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import { isSmartAccount } from '../../libs/account/account'
import { getAccountOpId } from '../../libs/accountOp/accountOp'
import findAccountOpInSignAccountOpsToBeSigned from '../../utils/findAccountOpInSignAccountOpsToBeSigned'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'

export const BENZIN_NOTIFICATION_DATA = { screen: 'Benzin', method: 'benzin' }

export const SIGN_METHODS = [
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_sign',
  'eth_sign',
  'eth_sendTransaction',
  'gs_multi_send',
  'ambire_sendBatchTransaction'
]

export const CHAIN_METHODS = ['wallet_switchEthereumChain', 'wallet_addEthereumChain']

const QUEUE_REQUEST_METHODS_WHITELIST = SIGN_METHODS

export const isSignAccountOpMethod = (method: string) => {
  return ['eth_sendTransaction', 'gs_multi_send', 'ambire_sendBatchTransaction'].includes(method)
}

export const isSignTypedDataMethod = (method: string) => {
  return [
    'eth_signTypedData',
    'eth_signTypedData_v1',
    'eth_signTypedData_v3',
    'eth_signTypedData_v4'
  ].includes(method)
}

export const isSignMessageMethod = (method: string) => {
  return ['personal_sign', 'eth_sign'].includes(method)
}

export const getScreenType = (kind: UserRequest['action']['kind']) => {
  if (kind === 'call') return 'SendTransaction'
  if (kind === 'message') return 'SignText'
  if (kind === 'typedMessage') return 'SignTypedData'
  return undefined
}

type Request = {
  method: string
  params?: any
  session: { name: string; origin: string; icon: string }
  origin: string
  screen: string
  meta?: { [key: string]: any }
}

export type NotificationRequest = Request &
  (
    | {
        id: string
        isSignRequest: false
        promises: {
          resolve: (data: any) => void
          reject: (data: any) => void
        }[]
      }
    | {
        id: string
        isSignRequest: true
        promises: {
          fromUserRequestId: number
          resolve: (data: any) => void
          reject: (data: any) => void
        }[]
      }
  )

export class NotificationController extends EventEmitter {
  #accounts: (Account & {
    newlyCreated?: boolean | undefined
  })[]

  #networks: (NetworkDescriptor & (NetworkPreference | CustomNetwork))[]

  #windowManager: WindowManager

  #getDapp: (url: string) => Dapp

  notificationRequests: NotificationRequest[] = []

  notificationWindowId: null | number = null

  currentNotificationRequest: NotificationRequest | null = null

  constructor({
    accounts,
    networks,
    windowManager,
    getDapp
  }: {
    accounts: (Account & {
      newlyCreated?: boolean | undefined
    })[]
    networks: (NetworkDescriptor & (NetworkPreference | CustomNetwork))[]
    windowManager: WindowManager
    getDapp: (url: string) => Dapp
  }) {
    super()
    this.#windowManager = windowManager
    this.#getDapp = getDapp
    this.#accounts = accounts
    this.#networks = networks

    this.#windowManager.event.on('windowRemoved', (winId: number) => {
      if (winId === this.notificationWindowId) {
        this.notificationWindowId = null
        // TODO: this.notifyForClosedUserRequestThatAreStillPending()
        this.rejectAllNotificationRequestsThatAreNotSignRequests()
      }
    })
  }

  requestNotificationRequest = (request: Request, openNewWindow: boolean = true): Promise<any> => {
    // Delete the current notification request if it's a benzin request
    if (this.currentNotificationRequest?.method === BENZIN_NOTIFICATION_DATA.method) {
      this.#deleteNotificationRequest(this.currentNotificationRequest.id)
      this.currentNotificationRequest = null
    }

    return new Promise((resolve, reject) => {
      if (
        !QUEUE_REQUEST_METHODS_WHITELIST.includes(request.method) &&
        this.notificationWindowId &&
        this.currentNotificationRequest
      ) {
        if (request.method === this.currentNotificationRequest.method) {
          this.#rejectNotificationRequestPromises(
            'Request rejected',
            this.currentNotificationRequest.id
          )
          this.#deleteNotificationRequest(this.currentNotificationRequest.id)
        } else {
          this.focusCurrentNotificationWindow(
            'You currently have a pending dApp request. Please resolve it before making another request.'
          )
          throw ethErrors.provider.userRejectedRequest(
            'please request after current request resolve'
          )
        }
      }

      if (CHAIN_METHODS.includes(request.method)) {
        let chainId = request.params?.[0]?.chainId
        if (typeof chainId === 'string') chainId = Number(chainId)

        const network = this.#networks.find((n) => Number(n.chainId) === chainId)

        if (network) {
          reject(null)
          return
        }
      }

      if (!SIGN_METHODS.includes(request.method)) {
        const id = new Date().getTime().toString()

        const notificationRequest: NotificationRequest = {
          ...request,
          id,
          isSignRequest: false,
          promises: [{ resolve, reject }]
        }

        this.#addNotificationRequest(notificationRequest)

        this.emitUpdate()
        if (openNewWindow) this.#openNotificationWindow()
        return
      }

      //
      // Handle SIGN_METHODS
      //

      if (isSignAccountOpMethod(request.method)) {
        this.#addSignAccountOpRequest(
          request,
          {
            reject,
            resolve
          },
          openNewWindow
        )
        return
      }

      if (isSignMessageMethod(request.method)) {
        // const userNotification = new UserNotification(this.#dappsCtrl)
        // const userRequest = userNotification.createSignMessageUserRequest({
        //   id,
        //   data: request.params,
        //   origin: request.origin,
        //   selectedAccount: this.#mainCtrl.selectedAccount || '',
        //   networks: this.#mainCtrl.settings.networks,
        //   onError: (err) => this.rejectNotificationRequest(err),
        //   onSuccess: (data, id) => this.resolveNotificationRequest(data, id)
        // })
        // if (userRequest) this.#mainCtrl.addUserRequest(userRequest)
        // else {
        //   this.rejectNotificationRequest('Invalid request data')
        //   return
        // }
      }

      if (isSignTypedDataMethod(request.method)) {
        // const userNotification = new UserNotification(this.#dappsCtrl)
        // const userRequest = userNotification.createSignTypedDataUserRequest({
        //   id,
        //   data: request.params,
        //   origin: request.origin,
        //   selectedAccount: this.#mainCtrl.selectedAccount || '',
        //   networks: this.#mainCtrl.settings.networks,
        //   onError: (err) => this.rejectNotificationRequest(err),
        //   onSuccess: (data, id) => this.resolveNotificationRequest(data, id)
        // })
        // if (userRequest) this.#mainCtrl.addUserRequest(userRequest)
        // else {
        //   this.rejectNotificationRequest('Invalid request data')
        // }
      }
    })
  }

  resolveNotificationRequest = (data: any, requestId?: string) => {
    let notificationRequest = this.currentNotificationRequest

    if (requestId) {
      const notificationRequestById = this.notificationRequests.find((req) => req.id === requestId)
      if (notificationRequestById) notificationRequest = notificationRequestById
    }

    if (!notificationRequest) return // TODO: emit error

    this.#resolveNotificationRequestPromises(data, notificationRequest.id)

    if (!SIGN_METHODS.includes(notificationRequest.method)) {
      this.#setNextNotificationRequestOnResolve(notificationRequest)
    }

    if (isSignAccountOpMethod(notificationRequest.method)) {
      this.#removeAccountOp(notificationRequest)
      const meta = { ...notificationRequest.meta, txnId: null, userOpHash: null }
      data?.isUserOp ? (meta.userOpHash = data.hash) : (meta.txnId = data.hash)
      this.requestNotificationRequest(
        {
          ...notificationRequest,
          screen: BENZIN_NOTIFICATION_DATA.screen,
          method: BENZIN_NOTIFICATION_DATA.method,
          meta
        },
        false
      )
      return
    }

    this.emitUpdate()
  }

  rejectNotificationRequest = async (err: string, requestId?: string) => {
    let notificationRequest = this.currentNotificationRequest

    if (requestId) {
      const notificationRequestById = this.notificationRequests.find((req) => req.id === requestId)
      if (notificationRequestById) notificationRequest = notificationRequestById
    }

    if (!notificationRequest) return // TODO: emit error

    this.#rejectNotificationRequestPromises(err, notificationRequest.id)

    if (!SIGN_METHODS.includes(notificationRequest.method)) {
      this.#setNextNotificationRequestOnReject(notificationRequest)
    }

    if (isSignAccountOpMethod(notificationRequest.method)) {
      this.#removeAccountOp(notificationRequest)
    }

    this.emitUpdate()
  }

  #addNotificationRequest(request: NotificationRequest) {
    this.notificationRequests = [request, ...this.notificationRequests]
    this.currentNotificationRequest = request
  }

  #doesAccountSupportsBatching(accountAddr: string) {
    const account = this.#accounts.find((a) => a.addr === accountAddr)
    return !!account && isSmartAccount(account)
  }

  async #addSignAccountOpRequest(
    request: Request,
    promise: {
      resolve: (data: any) => void
      reject: (data: any) => void
    },
    openNewWindow: boolean = true
  ) {
    const transaction = request.params[0]
    const network = this.#networks.find(
      (n) => Number(n.chainId) === Number(this.#getDapp(request.origin)?.chainId)
    )

    if (!network) {
      this.#rejectNotificationRequestPromises
      promise.reject('Unsupported network')
      return
    }

    const accountAddr = transaction.from
    if (!accountAddr) {
      promise.reject('Invalid transaction params')
      return
    }
    delete transaction.from
    const userRequest: UserRequest = {
      id: new Date().getTime(),
      action: {
        kind: 'call',
        ...transaction,
        value: transaction.value ? getBigInt(transaction.value) : 0n
      },
      networkId: network.id,
      accountAddr,
      // TODO: ?
      forceNonce: null
    }

    await this.#mainCtrl.addUserRequest(userRequest)

    const existingNotificationRequest = this.notificationRequests.find(
      (r) => r.id === getAccountOpId(userRequest.accountAddr, userRequest.networkId)
    )

    if (existingNotificationRequest) {
      this.notificationRequests.map((r) => {
        if (r.id === getAccountOpId(userRequest.accountAddr, userRequest.networkId) && !r.isReady) {
          foundNotificationRequest = true
          return { ...notificationRequestFromUserRequest, promises: r.promises }
        }

        return r
      })
    }

    this.notificationRequests.map((r) => {
      if (r.id === getAccountOpId(userRequest.accountAddr, userRequest.networkId) && !r.isReady) {
        foundNotificationRequest = true
        return { ...notificationRequestFromUserRequest, promises: r.promises }
      }

      return r
    })

    if (
      this.notificationRequests.find(
        (r) => r.id === getAccountOpId(userRequest.accountAddr, userRequest.networkId)
      )
    ) {
      this.emitUpdate()
      if (openNewWindow) this.#openNotificationWindow()
    } else {
      this.#addNotificationRequest({
        ...notificationRequest,
        id: getAccountOpId(userRequest.accountAddr, userRequest.networkId)
      })
    }
  }

  #removeAccountOp(request: NotificationRequest) {
    const accountOp = findAccountOpInSignAccountOpsToBeSigned(
      this.#mainCtrl.accountOpsToBeSigned,
      request.meta?.accountAddr,
      request.meta?.networkId
    )
    if (accountOp)
      this.#mainCtrl.removeAccountOp(request.meta?.accountAddr, request.meta?.networkId)
  }

  #resolveNotificationRequestPromises(data: any, requestId: string) {
    const notificationRequest = this.notificationRequests.find((r) => r.id === requestId)
    if (notificationRequest) notificationRequest.promises.forEach((p) => p.resolve(data))
  }

  #rejectNotificationRequestPromises(err: string, requestId: string) {
    const notificationRequest = this.notificationRequests.find((r) => r.id === requestId)
    if (notificationRequest) notificationRequest.promises.forEach((p) => p.reject(err))
  }

  #deleteNotificationRequest(requestId: string) {
    if (this.notificationRequests.length) {
      this.notificationRequests = this.notificationRequests.filter((r) => r.id !== requestId)
    } else {
      this.currentNotificationRequest = null
    }
  }

  #setNextNotificationRequestOnResolve(currentNotificationRequest: NotificationRequest) {
    const currentOrigin = currentNotificationRequest?.origin
    this.#deleteNotificationRequest(currentNotificationRequest.id)
    const nextNotificationRequest = this.notificationRequests[0]
    const nextOrigin = nextNotificationRequest?.origin

    if (!nextNotificationRequest) {
      this.currentNotificationRequest = null
      return
    }

    if (!SIGN_METHODS.includes(nextNotificationRequest?.params?.method)) {
      this.currentNotificationRequest = nextNotificationRequest
      return
    }

    if (currentOrigin && nextOrigin && currentOrigin === nextOrigin) {
      this.currentNotificationRequest = nextNotificationRequest
    }
  }

  #setNextNotificationRequestOnReject(currentNotificationRequest: NotificationRequest) {
    this.#deleteNotificationRequest(currentNotificationRequest.id)
    const nextNotificationRequest = this.notificationRequests[0]

    if (!nextNotificationRequest) {
      this.currentNotificationRequest = null
      return
    }
    if (SIGN_METHODS.includes(nextNotificationRequest.method)) {
      this.currentNotificationRequest = null
      return
    }

    this.currentNotificationRequest = nextNotificationRequest
  }

  rejectAllNotificationRequestsThatAreNotSignRequests = () => {
    this.notificationRequests.forEach((notificationReq: NotificationRequest) => {
      if (!SIGN_METHODS.includes(notificationReq.method)) {
        this.rejectNotificationRequest(
          `User rejected the request: ${notificationReq.method}`,
          notificationReq.id
        )
      }
    })
    this.emitUpdate()
  }

  // TODO:
  // notifyForClosedUserRequestThatAreStillPending = async () => {
  //   if (
  //     this.currentNotificationRequest &&
  //     SIGN_METHODS.includes(this.currentNotificationRequest.method)
  //   ) {
  //     const title = isSignAccountOpMethod(this.currentNotificationRequest.method)
  //       ? 'Added Pending Transaction Request'
  //       : 'Added Pending Message Request'
  //     const message = isSignAccountOpMethod(this.currentNotificationRequest.method)
  //       ? 'Transaction added to your cart. You can add more transactions and sign them all together (thus saving on network fees).'
  //       : 'The message was added to your cart. You can find all pending requests listed on your Dashboard.'

  //     const id = new Date().getTime()
  //     // service_worker (mv3) - without await the notification doesn't show
  //     await browser.notifications.create(id.toString(), {
  //       type: 'basic',
  //       iconUrl: browser.runtime.getURL('assets/images/xicon@96.png'),
  //       title,
  //       message,
  //       priority: 2
  //     })
  //   }
  // }

  #openNotificationWindow = async () => {
    await wait(1) // Open on next tick to ensure that state update is emitted to FE before opening the window
    if (this.notificationWindowId !== null) {
      this.#windowManager.remove(this.notificationWindowId)
      this.notificationWindowId = null
      this.emitUpdate()
    }
    this.#windowManager.openNotification().then((winId) => {
      this.notificationWindowId = winId!
      this.emitUpdate()
    })
  }

  focusCurrentNotificationWindow = (warningMessage?: string) => {
    if (
      !this.notificationRequests.length ||
      !this.currentNotificationRequest ||
      !this.notificationWindowId
    )
      return

    this.#windowManager.focus(this.notificationWindowId)
    // TODO:
    // this.#pm.send('> ui-warning', {
    //   method: 'notification',
    //   params: { warnings: [warningMessage], controller: 'notification' }
    // })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
