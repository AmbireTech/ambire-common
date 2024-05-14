/* eslint-disable @typescript-eslint/no-floating-promises */
import { ethErrors } from 'eth-rpc-errors'
import { getAddress, getBigInt } from 'ethers'

import { Dapp, DappProviderRequest } from '../../interfaces/dapp'
import {
  CurrentNotification,
  DappNotificationRequest,
  Message,
  NotificationRequest,
  SignNotificationRequest
} from '../../interfaces/notification'
import { WindowManager } from '../../interfaces/window'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { EstimateResult } from '../../libs/estimate/interfaces'
import { dappRequestMethodToActionKind } from '../../libs/notification/notification'
import EventEmitter from '../eventEmitter/eventEmitter'
/* eslint-disable @typescript-eslint/no-shadow */
import { SettingsController } from '../settings/settings'

export class NotificationController extends EventEmitter {
  #settings: SettingsController

  #accountOpsToBeSigned: {
    [key: string]: {
      [key: string]: { accountOp: AccountOp; estimation: EstimateResult | null } | null
    }
  } = {}

  #messagesToBeSigned: { [key: string]: Message[] } = {}

  #windowManager: WindowManager

  #getDapp: (url: string) => Dapp | undefined

  notificationRequests: NotificationRequest[] = []

  notificationWindowId: null | number = null

  #currentNotificationQueue: CurrentNotification[] = []

  #currentNotification: CurrentNotification | null = null

  get currentNotification() {
    return this.#currentNotification
  }

  set currentNotification(value: CurrentNotification | null) {
    if (this.currentNotification && value) {
      this.#currentNotificationQueue.push(value)
      this.openNotificationWindow()
      return
    }

    this.#currentNotification = value

    if (!value) {
      !!this.notificationWindowId &&
        this.#windowManager.remove(this.notificationWindowId).then(() => {
          this.notificationWindowId = null
          this.emitUpdate()
        })
    } else {
      this.openNotificationWindow()
    }
  }

  #onAddNotificationRequestCallback: (request: NotificationRequest) => Promise<void>

  #onRemoveNotificationRequestCallback: (request: NotificationRequest) => Promise<void>

  constructor({
    settings,
    accountOpsToBeSigned,
    messagesToBeSigned,
    windowManager,
    getDapp,
    onAddNotificationRequest,
    onRemoveNotificationRequest
  }: {
    settings: SettingsController
    accountOpsToBeSigned: {
      [key: string]: {
        [key: string]: { accountOp: AccountOp; estimation: EstimateResult | null } | null
      }
    }
    messagesToBeSigned: { [key: string]: Message[] }
    windowManager: WindowManager
    getDapp: (url: string) => Dapp | undefined
    onAddNotificationRequest: (request: NotificationRequest) => Promise<void>
    onRemoveNotificationRequest: (request: NotificationRequest) => Promise<void>
  }) {
    super()

    this.#settings = settings
    this.#accountOpsToBeSigned = accountOpsToBeSigned
    this.#messagesToBeSigned = messagesToBeSigned
    this.#windowManager = windowManager
    this.#getDapp = getDapp
    this.#onAddNotificationRequestCallback = onAddNotificationRequest
    this.#onRemoveNotificationRequestCallback = onRemoveNotificationRequest

    this.#windowManager.event.on('windowRemoved', (winId: number) => {
      if (winId === this.notificationWindowId) {
        this.notificationWindowId = null
        // TODO: this.notifyForClosedUserRequestThatAreStillPending()
        this.rejectAllNotificationRequestsThatAreNotSignRequests()
      }
    })
  }

  async buildNotificationRequest(
    request: DappProviderRequest,
    dappPromise: {
      resolve: (data: any) => void
      reject: (data: any) => void
    }
  ) {
    let notificationRequest = null
    const kind = dappRequestMethodToActionKind(request.method)

    const network = this.#settings.networks.find(
      (n) => Number(n.chainId) === Number(this.#getDapp(request.origin)?.chainId)
    )

    if (!network) {
      throw ethErrors.provider.chainDisconnected('Transaction failed - unknown network')
    }

    if (kind === 'call') {
      const transaction = request.params[0]
      const accountAddr = getAddress(transaction.from)

      delete transaction.from
      notificationRequest = {
        id: new Date().getTime(),
        action: {
          kind,
          params: {
            ...transaction,
            value: transaction.value ? getBigInt(transaction.value) : 0n
          }
        },
        meta: { isSign: true, accountAddr, networkId: network.id },
        dappPromise
      } as SignNotificationRequest
    } else if (kind === 'message') {
      // TODO:
    } else if (kind === 'typedMessage') {
      // TODO:
    } else {
      notificationRequest = {
        id: new Date().getTime(),
        session: request.session,
        action: { kind, params: request.params },
        meta: { isSign: false },
        dappPromise
      } as DappNotificationRequest
    }

    if (notificationRequest) {
      this.notificationRequests.push(notificationRequest)
      await this.#onAddNotificationRequestCallback(notificationRequest)
      if (
        notificationRequest.action.kind === 'call' &&
        this.#accountOpsToBeSigned[notificationRequest.meta.accountAddr][
          notificationRequest.meta.networkId
        ]
      ) {
        this.currentNotification = {
          type: 'accountOp',
          accountAddr: notificationRequest.meta.accountAddr,
          networkId: notificationRequest.meta.networkId
        }
      }
      this.emitUpdate()
    }
  }

  resolveNotificationRequest = (data: any, requestId: number) => {
    const notificationRequest = this.notificationRequests.find((r) => r.id === requestId)

    if (!notificationRequest) return // TODO: emit error

    this.#resolveAndDeleteNotificationRequestPromise(data, notificationRequest.id)

    this.#setNextNotificationRequest()
    this.emitUpdate()
  }

  rejectNotificationRequest = async (err: string, requestId: number) => {
    const notificationRequest = this.notificationRequests.find((r) => r.id === requestId)

    if (!notificationRequest) return // TODO: emit error

    this.#rejectAndDeleteNotificationRequestPromise(err, notificationRequest.id)

    if (!notificationRequest.meta.isSign) {
      this.#setNextNotificationRequest()
    }
    this.emitUpdate()
  }

  #resolveAndDeleteNotificationRequestPromise(data: any, requestId: number) {
    const notificationRequest = this.notificationRequests.find((r) => r.id === requestId)
    if (notificationRequest) {
      notificationRequest?.dappPromise?.resolve(data)
      this.#deleteNotificationRequest(requestId)
    }
  }

  #rejectAndDeleteNotificationRequestPromise(err: string, requestId: number) {
    const notificationRequest = this.notificationRequests.find((r) => r.id === requestId)
    if (notificationRequest) {
      notificationRequest?.dappPromise?.reject(err)
      this.#deleteNotificationRequest(requestId)
    }
  }

  #deleteNotificationRequest(requestId: number) {
    this.notificationRequests = this.notificationRequests.filter((r) => r.id !== requestId)

    if (!this.notificationRequests.length) {
      this.currentNotification = null
    }
  }

  #setNextNotificationRequest() {
    const dappRequests = this.notificationRequests.filter((r) => !r.meta.isSign)
    if (!dappRequests.length) {
      this.currentNotification = null
      return
    }

    this.currentNotification = {
      type: 'notificationRequest',
      notificationRequest: dappRequests[0]
    }
  }

  rejectAllNotificationRequestsThatAreNotSignRequests = () => {
    this.notificationRequests.forEach((r: NotificationRequest) => {
      if (!['call', 'typedMessage', 'message'].includes(r.action.kind)) {
        this.rejectNotificationRequest(`User rejected the request: ${r.action.kind}`, r.id)
      }
    })
    this.emitUpdate()
  }

  // TODO:
  // notifyForClosedUserRequestThatAreStillPending = async () => {
  //   if (
  //     this.currentNotification &&
  //     SIGN_METHODS.includes(this.currentNotification.method)
  //   ) {
  //     const title = isSignAccountOpMethod(this.currentNotification.method)
  //       ? 'Added Pending Transaction Request'
  //       : 'Added Pending Message Request'
  //     const message = isSignAccountOpMethod(this.currentNotification.method)
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

  openNotificationWindow() {
    if (this.notificationWindowId !== null) {
      this.focusCurrentNotificationWindow()
    } else {
      this.#windowManager.open().then((winId) => {
        this.notificationWindowId = winId!
        this.emitUpdate()
      })
    }
  }

  focusCurrentNotificationWindow = (warningMessage?: string) => {
    if (
      !this.notificationRequests.length ||
      !this.currentNotification ||
      !this.notificationWindowId
    )
      return

    this.#windowManager.focus(this.notificationWindowId)
    // TODO:
    if (warningMessage) {
      // this.#pm.send('> ui-warning', {
      //   method: 'notification',
      //   params: { warnings: [warningMessage], controller: 'notification' }
      // })
    }
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
