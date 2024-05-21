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

export class ActionsController extends EventEmitter {
  #windowManager: WindowManager

  actionWindowId: null | number = null

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
    }
    this.setCurrentAction(
      this.actionsQueue[0] || null,
      !withPriority && this.actionsQueue.length > 1
    )
  }

  removeFromActionsQueue(actionId: Action['id']) {
    this.actionsQueue = this.actionsQueue.filter((a) => a.id !== actionId)

    this.setCurrentAction(this.actionsQueue[0] || null)
  }

  setCurrentAction(nextAction: Action | null, withMessage?: boolean) {
    if (nextAction && nextAction.id === this.currentAction?.id) {
      this.openActionWindow(withMessage)
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
      this.openActionWindow(withMessage)
    }

    this.emitUpdate()
  }

  openFirstPendingAction() {
    if (!this.actionsQueue.length || this.currentAction) return

    this.setCurrentAction(this.actionsQueue[0])
    this.#windowManager.sendWindowMessage('> ui-warning', 'You have unresolved pending requests.')

    this.emitUpdate()
  }

  openActionWindow(withMessage?: boolean) {
    if (this.actionWindowId !== null) {
      this.focusActionWindow(withMessage)
    } else {
      this.#windowManager.open().then((winId) => {
        this.actionWindowId = winId!
        this.emitUpdate()
      })
    }
  }

  focusActionWindow = (withMessage?: boolean) => {
    if (!this.actionsQueue.length || !this.currentAction || !this.actionWindowId) return

    this.#windowManager.focus(this.actionWindowId)
    if (withMessage) {
      this.#windowManager.sendWindowMessage(
        '> ui-warning',
        'You have pending requests. Please resolve them before accessing new ones.'
      )
    }
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
