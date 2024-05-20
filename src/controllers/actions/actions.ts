/* eslint-disable @typescript-eslint/no-floating-promises */

import { DappUserRequest, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import { AccountOp } from '../../libs/accountOp/accountOp'
import EventEmitter from '../eventEmitter/eventEmitter'

export type AccountOpAction = {
  id: string | number
  type: 'accountOp'
  accountOp: AccountOp
  withBatching: boolean
}

export type SignMessageAction = {
  id: number
  type: 'signMessage'
  userRequest: SignUserRequest
}

export type BenzinAction = {
  id: number
  type: 'benzin'
}

export type UserRequestAction = {
  id: number
  type: DappUserRequest['action']['kind']
  userRequest: UserRequest
}

export type Action = AccountOpAction | SignMessageAction | BenzinAction | UserRequestAction

export class ActionsController extends EventEmitter {
  #windowManager: WindowManager

  #userRequests: UserRequest[] = []

  actionWindowId: null | number = null

  #actionsQueue: Action[] = []

  currentAction: Action | null = null

  constructor({
    userRequests,
    windowManager
  }: {
    userRequests: UserRequest[]
    windowManager: WindowManager
  }) {
    super()

    this.#userRequests = userRequests
    this.#windowManager = windowManager

    this.#windowManager.event.on('windowRemoved', (winId: number) => {
      if (winId === this.actionWindowId) {
        this.actionWindowId = null
        this.currentAction = null
        this.emitUpdate()
        // TODO: this.notifyForClosedUserRequestThatAreStillPending()
        // this.rejectAllNotificationRequestsThatAreNotSignRequests()
      }
    })
  }

  get numberOfPendingActions() {
    return this.#actionsQueue.length
  }

  addToActionsQueue(action: Action) {
    const actionIndex = this.#actionsQueue.findIndex((a) => a.id === action.id)
    if (actionIndex !== -1) {
      this.#actionsQueue[actionIndex] = action
      this.setCurrentAction(this.#actionsQueue[0] || null)
      return
    }

    this.#actionsQueue.push(action)
    this.setCurrentAction(this.#actionsQueue[0] || null)
  }

  removeFromActionsQueue(actionId: Action['id']) {
    this.#actionsQueue = this.#actionsQueue.filter((a) => a.id !== actionId)

    this.setCurrentAction(this.#actionsQueue[0] || null)
  }

  setCurrentAction(nextAction: Action | null) {
    if (nextAction && nextAction.id === this.currentAction?.id) {
      this.openActionWindow()
      return
    }

    this.currentAction = nextAction

    if (!this.currentAction) {
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

  openFirstPendingAction() {
    if (!this.#actionsQueue.length || this.currentAction) return

    this.setCurrentAction(this.#actionsQueue[0])
    // TODO:
    // this.#pm.send('> ui-warning', {
    //   method: 'actions',
    //   params: { warnings: [warningMessage], controller: 'actions' }
    // })

    this.emitUpdate()
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

  focusActionWindow = () => {
    if (!this.#userRequests.length || !this.currentAction || !this.actionWindowId) return

    this.#windowManager.focus(this.actionWindowId)
    // TODO:
    // this.#pm.send('> ui-warning', {
    //   method: 'actions',
    //   params: { warnings: [warningMessage], controller: 'actions' }
    // })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      numberOfPendingActions: this.numberOfPendingActions
    }
  }
}
