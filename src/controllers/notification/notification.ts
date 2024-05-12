/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-shadow */
import { ethErrors } from 'eth-rpc-errors'

import { Account } from '../../interfaces/account'
import { Dapp } from '../../interfaces/dapp'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import {
  BasicNotificationRequest,
  NotificationRequest,
  SignNotificationRequest
} from '../../interfaces/notification'
import { CustomNetwork, NetworkPreference } from '../../interfaces/settings'
import { WindowManager } from '../../interfaces/window'
import {
  isSignAccountOpMethod,
  isSignMessageMethod,
  isSignTypedDataMethod,
  QUEUE_REQUEST_METHODS_WHITELIST,
  SIGN_METHODS
} from '../../libs/notification/notification'
import EventEmitter from '../eventEmitter/eventEmitter'

export class NotificationController extends EventEmitter {
  #windowManager: WindowManager

  #getDapp: (url: string) => Dapp | undefined

  notificationRequests: NotificationRequest[] = []

  notificationWindowId: null | number = null

  currentNotificationRequest: NotificationRequest | null = null

  constructor({
    windowManager,
    getDapp
  }: {
    accounts: (Account & {
      newlyCreated?: boolean | undefined
    })[]
    networks: (NetworkDescriptor & (NetworkPreference | CustomNetwork))[]
    windowManager: WindowManager
    getDapp: (url: string) => Dapp | undefined
  }) {
    super()
    this.#windowManager = windowManager
    this.#getDapp = getDapp

    this.#windowManager.event.on('windowRemoved', (winId: number) => {
      if (winId === this.notificationWindowId) {
        this.notificationWindowId = null
        // TODO: this.notifyForClosedUserRequestThatAreStillPending()
        this.rejectAllNotificationRequestsThatAreNotSignRequests()
      }
    })
  }

  requestBasicNotificationRequest = (
    request: BasicNotificationRequest,
    openNewWindow: boolean = true
  ) => {
    this.#validateRequest(request)

    this.#addNotificationRequest(request)
    this.currentNotificationRequest = request

    this.emitUpdate()
    if (openNewWindow) this.#openNotificationWindow()
  }

  requestAccountOpNotification(request: SignNotificationRequest, accountType: 'smart' | 'basic') {
    if (accountType === 'basic') {
      this.#addNotificationRequest(request)
      const firstNotificationRequestWithSameId = this.notificationRequests.find(
        (r) => r.id === request.id
      )
      this.currentNotificationRequest = firstNotificationRequestWithSameId || request
    }

    if (accountType === 'smart') {
      let alreadyAdded = false
      this.notificationRequests = this.notificationRequests.map((r) => {
        if (r.id === request.id) {
          alreadyAdded = true
          return {
            ...r,
            promises: [...r.promises, ...request.promises]
          }
        }

        return r
      })

      if (!alreadyAdded) {
        this.#addNotificationRequest(request)
      }
      this.currentNotificationRequest = request
    }

    this.emitUpdate()
    this.#openNotificationWindow()
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
      // this.#removeAccountOp(notificationRequest) // TODO:
      const meta = { ...notificationRequest.meta, txnId: null, userOpHash: null }
      data?.isUserOp ? (meta.userOpHash = data.hash) : (meta.txnId = data.hash)
      this.requestBasicNotificationRequest(
        {
          ...notificationRequest,
          method: 'benzin',
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

    this.emitUpdate()
  }

  #addNotificationRequest(request: NotificationRequest) {
    this.notificationRequests = [request, ...this.notificationRequests]
  }

  getNotificationRequestById(requestId: string) {
    return this.notificationRequests.find((r) => r.id === requestId)
  }

  #validateRequest(request: NotificationRequest) {
    // Delete the current notification request if it's a benzin request
    if (this.currentNotificationRequest?.method === 'benzin') {
      this.#deleteNotificationRequest(this.currentNotificationRequest.id)
      this.currentNotificationRequest = null
    }

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
        throw ethErrors.provider.userRejectedRequest('please request after current request resolve')
      }
    }
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
    if (this.notificationWindowId !== null) {
      this.#windowManager.remove(this.notificationWindowId)
      this.notificationWindowId = null
      this.emitUpdate()
    }
    this.#windowManager.open().then((winId) => {
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
