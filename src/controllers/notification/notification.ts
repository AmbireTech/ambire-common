/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-shadow */
import { ethErrors } from 'eth-rpc-errors'
import { getBigInt } from 'ethers'

import { Account } from '../../interfaces/account'
import { Dapp } from '../../interfaces/dapp'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { NotificationRequest } from '../../interfaces/notification'
import { CustomNetwork, NetworkPreference } from '../../interfaces/settings'
import { UserRequest } from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import { isSmartAccount } from '../../libs/account/account'
import { getAccountOpId } from '../../libs/accountOp/accountOp'
import {
  isSignAccountOpMethod,
  isSignMessageMethod,
  isSignTypedDataMethod,
  QUEUE_REQUEST_METHODS_WHITELIST,
  SIGN_METHODS
} from '../../libs/notification/notification'
import findAccountOpInSignAccountOpsToBeSigned from '../../utils/findAccountOpInSignAccountOpsToBeSigned'
import EventEmitter from '../eventEmitter/eventEmitter'

export class NotificationController extends EventEmitter {
  #accounts: (Account & {
    newlyCreated?: boolean | undefined
  })[]

  #networks: (NetworkDescriptor & (NetworkPreference | CustomNetwork))[]

  #windowManager: WindowManager

  #getDapp: (url: string) => Dapp | undefined

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
    getDapp: (url: string) => Dapp | undefined
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

  requestNotificationRequest = (request: NotificationRequest, openNewWindow: boolean = true) => {
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

    if (!SIGN_METHODS.includes(request.method)) {
      this.#addNotificationRequest(request)

      this.emitUpdate()
      if (openNewWindow) this.#openNotificationWindow()
      return
    }

    //
    // Handle SIGN_METHODS
    //

    if (isSignAccountOpMethod(request.method)) {
      this.#addSignAccountOpRequest(request, openNewWindow)
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
    request: NotificationRequest,
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
