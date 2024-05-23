/* eslint-disable @typescript-eslint/no-floating-promises */

import { DappUserRequest, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import { AccountOp } from '../../libs/accountOp/accountOp'
import EventEmitter from '../eventEmitter/eventEmitter'

export type AccountOpAction = {
  id: string | UserRequest['id']
  type: 'accountOp'
  accountOp: AccountOp
  withBatching: boolean
}

export type SignMessageAction = {
  id: SignUserRequest['id']
  type: 'signMessage'
  userRequest: SignUserRequest
}

export type BenzinAction = {
  id: UserRequest['id']
  type: 'benzin'
  userRequest: UserRequest
}

export type UserRequestAction = {
  id: UserRequest['id']
  type: DappUserRequest['action']['kind']
  userRequest: UserRequest
}

export type Action = AccountOpAction | SignMessageAction | BenzinAction | UserRequestAction

/**
 * The ActionsController is responsible for storing the converted userRequests
 * from the MainController into actions. After adding an action an action-window will be opened with the first action form actionsQueue
 * For most userRequests, there is a corresponding action in the actionsQueue
 * containing the details of the userRequest needed for displaying it to the user.
 * However, some userRequests can be batched together, resulting in a single action created for multiple requests.
 *
 * After being opened, the action-window will remain visible to the user until all actions are resolved or rejected,
 * or until the user forcefully closes the window using the system close icon (X).
 * All pending/unresolved actions that do not have banners will be prompted to the user first time they click on the Ambire extension icon
 * аnd these actions with banners can remain pending until the user decides to reject or open them.
 */
export class ActionsController extends EventEmitter {
  #windowManager: WindowManager

  actionWindowId: number | null = null

  actionsQueue: Action[] = []

  currentAction: Action | null = null

  #onActionWindowClose: () => void

  constructor({
    windowManager,
    onActionWindowClose
  }: {
    windowManager: WindowManager
    onActionWindowClose: () => void
  }) {
    super()

    this.#windowManager = windowManager
    this.#onActionWindowClose = onActionWindowClose

    this.#windowManager.event.on('windowRemoved', (winId: number) => {
      if (winId === this.actionWindowId) {
        this.#onActionWindowClose()
        this.actionWindowId = null
        this.currentAction = null

        // we have banners for these actions on the dashboard
        this.actionsQueue = this.actionsQueue.filter(
          (a) => !['accountOp', 'benzin'].includes(a.type)
        )
        this.emitUpdate()
      }
    })
  }

  addToActionsQueue(action: Action, withPriority?: boolean) {
    const actionIndex = this.actionsQueue.findIndex((a) => a.id === action.id)
    if (actionIndex !== -1) {
      this.actionsQueue[actionIndex] = action
      this.setCurrentAction(this.actionsQueue[0] || null)
      return
    }

    if (withPriority) {
      this.actionsQueue.unshift(action)
    } else {
      this.actionsQueue.push(action)
      if (this.actionWindowId && action.type !== 'benzin') {
        this.#windowManager.sendWindowToastMessage('A new action request was added to the queue.', {
          type: 'success'
        })
      }
    }
    this.setCurrentAction(this.actionsQueue[0] || null)
  }

  removeFromActionsQueue(actionId: Action['id']) {
    this.actionsQueue = this.actionsQueue.filter((a) => a.id !== actionId)

    this.setCurrentAction(this.actionsQueue[0] || null)
  }

  setCurrentAction(nextAction: Action | null) {
    if (nextAction && nextAction.id === this.currentAction?.id) {
      this.openActionWindow()
      this.emitUpdate()
      return
    }

    this.currentAction = nextAction

    if (!this.currentAction) {
      !!this.actionWindowId && this.#windowManager.remove(this.actionWindowId)
    } else {
      this.openActionWindow()
    }

    this.emitUpdate()
  }

  openFirstPendingAction() {
    if (!this.actionsQueue.length || this.currentAction) return

    this.setCurrentAction(this.actionsQueue[0])
    this.emitUpdate()
  }

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
    if (!this.actionsQueue.length || !this.currentAction || !this.actionWindowId) return
    this.#windowManager.focus(this.actionWindowId)
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
