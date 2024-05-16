/* eslint-disable @typescript-eslint/no-floating-promises */

import { Dapp } from '../../interfaces/dapp'
import { DappUserRequest, Message, UserRequest } from '../../interfaces/userRequest'
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
  signMessage: Message
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

  #getDapp: (url: string) => Dapp | undefined

  #userRequests: UserRequest[] = []

  actionWindowId: null | number = null

  #actionsQueue: Action[] = []

  currentAction: Action | null = null

  constructor({
    userRequests,
    windowManager,
    getDapp
  }: {
    userRequests: UserRequest[]
    windowManager: WindowManager
    getDapp: (url: string) => Dapp | undefined
  }) {
    super()

    this.#userRequests = userRequests
    this.#windowManager = windowManager
    this.#getDapp = getDapp

    this.#windowManager.event.on('windowRemoved', (winId: number) => {
      if (winId === this.actionWindowId) {
        this.actionWindowId = null
        // TODO: this.notifyForClosedUserRequestThatAreStillPending()
        // this.rejectAllNotificationRequestsThatAreNotSignRequests()
      }
    })
  }

  addToActionsQueue(action: Action) {
    if (action.type === 'accountOp' && action.withBatching) {
      const opActionIndex = array.findIndex((a) => a.id === action.id)

      if (opActionIndex !== -1) {
        this.#actionsQueue[opActionIndex] = action
        this.setCurrentAction(this.#actionsQueue[0] || null)
        return
      }
    }

    if (this.#actionsQueue.find((a) => a.id === action.id)) return

    this.#actionsQueue.push(action)
    this.setCurrentAction(this.#actionsQueue[0] || null)
  }

  removeFromActionQueue(actionId: Action['id']) {
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
