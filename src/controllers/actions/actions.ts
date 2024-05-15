/* eslint-disable @typescript-eslint/no-floating-promises */

import { Dapp } from '../../interfaces/dapp'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { CustomNetwork, NetworkPreference } from '../../interfaces/settings'
import { Message, UserRequest } from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { EstimateResult } from '../../libs/estimate/interfaces'
import EventEmitter from '../eventEmitter/eventEmitter'

export type CurrentAction =
  | {
      type: 'accountOp'
      accountOp: AccountOp
    }
  | {
      type: 'signMessage'
      signMessage: Message
    }
  | {
      type: 'benzin'
    }
  | {
      type: 'userRequest'
      userRequest: UserRequest
    }

export class ActionsController extends EventEmitter {
  #networks: (NetworkDescriptor & (NetworkPreference | CustomNetwork))[]

  #accountOpsToBeSigned: {
    [key: string]: {
      [key: string]: { accountOp: AccountOp; estimation: EstimateResult | null } | null
    }
  } = {}

  #messagesToBeSigned: { [key: string]: Message[] } = {}

  #windowManager: WindowManager

  #getDapp: (url: string) => Dapp | undefined

  #userRequests: UserRequest[] = []

  actionWindowId: null | number = null

  #actionsQueue: CurrentAction[] = []

  currentAction: CurrentAction | null = null

  #onAddUserRequestCallback: (request: UserRequest) => Promise<void>

  #onRemoveUserRequestCallback: (request: UserRequest) => Promise<void>

  constructor({
    userRequests,
    networks,
    accountOpsToBeSigned,
    messagesToBeSigned,
    windowManager,
    getDapp,
    onAddUserRequest,
    onRemoveUserRequest
  }: {
    userRequests: UserRequest[]
    networks: (NetworkDescriptor & (NetworkPreference | CustomNetwork))[]
    accountOpsToBeSigned: {
      [key: string]: {
        [key: string]: { accountOp: AccountOp; estimation: EstimateResult | null } | null
      }
    }
    messagesToBeSigned: { [key: string]: Message[] }
    windowManager: WindowManager
    getDapp: (url: string) => Dapp | undefined
    onAddUserRequest: (request: UserRequest) => Promise<void>
    onRemoveUserRequest: (request: UserRequest) => Promise<void>
  }) {
    super()

    this.#userRequests = userRequests
    this.#networks = networks
    this.#accountOpsToBeSigned = accountOpsToBeSigned
    this.#messagesToBeSigned = messagesToBeSigned
    this.#windowManager = windowManager
    this.#getDapp = getDapp
    this.#onAddUserRequestCallback = onAddUserRequest
    this.#onRemoveUserRequestCallback = onRemoveUserRequest

    this.#windowManager.event.on('windowRemoved', (winId: number) => {
      if (winId === this.actionWindowId) {
        this.actionWindowId = null
        // TODO: this.notifyForClosedUserRequestThatAreStillPending()
        this.rejectAllNotificationRequestsThatAreNotSignRequests()
      }
    })
  }

  addToActionsQueue(action: CurrentAction) {
    if (
      action.type === 'accountOp' &&
      this.#actionsQueue.find(
        (a) => a.type === action.type && a.accountAddr === action.accountAddr && action.networkId
      )
    ) {
      return
    }

    if (
      action.type === 'signMessage' &&
      this.#actionsQueue.find(
        (a) => a.type === action.type && a.accountAddr === action.accountAddr && action.networkId
      )
    ) {
      return
    }

    this.#actionsQueue.push(action)
  }

  setCurrentAction(action: CurrentAction | null) {
    if (this.currentAction && action) {
      addToActionsQueue(action)
      this.openActionWindow()

      this.emitUpdate()
      return
    }

    const nextAction = null
    if (!newAction && this.#actionsQueue.length) {
      nextAction = this.#actionsQueue[0]
    } else {
      nextAction = action
    }
    this.#currentAction = nextAction

    if (!nextAction) {
      !!this.actionWindowId &&
        this.#windowManager.remove(this.actionWindowId).then(() => {
          this.actionWindowId = null
          this.emitUpdate()
        })
    } else {
      this.openActionWindow()
    }

    this.emitUpdate()
  }

  #setNextNotificationRequest(notificationRequest: UserRequest) {
    if (
      notificationRequest.action.kind === 'call' &&
      this.#accountOpsToBeSigned[notificationRequest.meta.accountAddr][
        notificationRequest.meta.networkId
      ]
    ) {
      return
    }

    const dappRequests = this.#userRequests.filter((r) => !r.meta.isSign)
    if (!dappRequests.length) {
      this.currentAction = null
      return
    }

    this.currentAction = {
      type: 'notificationRequest',
      notificationRequest: dappRequests[0]
    }
  }

  rejectAllNotificationRequestsThatAreNotSignRequests = () => {
    this.#userRequests.forEach((r: UserRequest) => {
      if (!['call', 'typedMessage', 'message'].includes(r.action.kind)) {
        this.rejectUserRequest(`User rejected the request: ${r.action.kind}`, r.id)
      }
    })
    this.emitUpdate()
  }

  // TODO:
  // notifyForClosedUserRequestThatAreStillPending = async () => {
  //   if (
  //     this.currentAction &&
  //     SIGN_METHODS.includes(this.currentAction.method)
  //   ) {
  //     const title = isSignAccountOpMethod(this.currentAction.method)
  //       ? 'Added Pending Transaction Request'
  //       : 'Added Pending Message Request'
  //     const message = isSignAccountOpMethod(this.currentAction.method)
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

  openActionWindow() {
    if (this.actionWindowId !== null) {
      this.focusActionWindow()
    } else {
      this.#windowManager.open().then((winId) => {
        this.actionWindowId = winId!
        this.emitUpdate()
      })
    }
  }

  focusActionWindow = (warningMessage?: string) => {
    if (!this.#userRequests.length || !this.currentAction || !this.actionWindowId) return

    this.#windowManager.focus(this.actionWindowId)
    // TODO:
    if (warningMessage) {
      // this.#pm.send('> ui-warning', {
      //   method: 'actions',
      //   params: { warnings: [warningMessage], controller: 'actions' }
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
