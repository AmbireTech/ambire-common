/* eslint-disable @typescript-eslint/no-floating-promises */

import { Account } from '../../interfaces/account'
import { DappUserRequest, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import { AccountOp } from '../../libs/accountOp/accountOp'
// eslint-disable-next-line import/no-cycle
import { messageOnNewAction } from '../../libs/actions/actions'
import { getDappActionRequestsBanners } from '../../libs/banners/banners'
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'

export type AccountOpAction = {
  id: SignUserRequest['id']
  type: 'accountOp'
  accountOp: AccountOp
}

export type SignMessageAction = {
  id: SignUserRequest['id']
  type: 'signMessage'
  userRequest: SignUserRequest
}

export type BenzinAction = {
  id: UserRequest['id']
  type: 'benzin'
  userRequest: SignUserRequest
}

export type DappRequestAction = {
  id: UserRequest['id']
  type: 'dappRequest'
  userRequest: DappUserRequest
}

export type Action = AccountOpAction | SignMessageAction | BenzinAction | DappRequestAction

/**
 * The ActionsController is responsible for storing the converted userRequests
 * from the MainController into actions. After adding an action an action-window will be opened with the first action form actionsQueue
 * For most userRequests, there is a corresponding action in the actionsQueue
 * containing the details of the userRequest needed for displaying it to the user.
 * However, some userRequests can be batched together, resulting in a single action created for multiple requests.
 *
 * After being opened, the action-window will remain visible to the user until all actions are resolved or rejected,
 * or until the user forcefully closes the window using the system close icon (X).
 * All pending/unresolved actions can be accessed later from the banners on the Dashboard screen.
 */
export class ActionsController extends EventEmitter {
  #accounts: AccountsController

  #windowManager: WindowManager

  actionWindow: {
    id: number | null
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
    id: null,
    loaded: false,
    pendingMessage: null
  }

  actionsQueue: Action[] = []

  currentAction: Action | null = null

  #onActionWindowClose: () => void

  get visibleActionsQueue(): Action[] {
    return this.actionsQueue.filter((a) => {
      if (a.type === 'accountOp') {
        return a.accountOp.accountAddr === this.#accounts.selectedAccount
      }
      if (a.type === 'signMessage') {
        return a.userRequest.meta.accountAddr === this.#accounts.selectedAccount
      }
      if (a.type === 'benzin') {
        return a.userRequest.meta.accountAddr === this.#accounts.selectedAccount
      }

      return true
    })
  }

  constructor({
    accounts,
    windowManager,
    onActionWindowClose
  }: {
    accounts: AccountsController
    windowManager: WindowManager
    onActionWindowClose: () => void
  }) {
    super()

    this.#accounts = accounts
    this.#windowManager = windowManager
    this.#onActionWindowClose = onActionWindowClose

    this.#windowManager.event.on('windowRemoved', (winId: number) => {
      if (winId === this.actionWindow.id) {
        this.#onActionWindowClose()
        this.actionWindow.id = null
        this.actionWindow.loaded = false
        this.actionWindow.pendingMessage = null
        this.currentAction = null

        this.actionsQueue = this.actionsQueue.filter((a) => !['benzin'].includes(a.type))
        this.emitUpdate()
      }
    })
  }

  addOrUpdateAction(newAction: Action, withPriority?: boolean) {
    const actionIndex = this.actionsQueue.findIndex((a) => a.id === newAction.id)
    if (actionIndex !== -1) {
      this.actionsQueue[actionIndex] = newAction
      this.sendNewActionMessage(newAction, 'update')
      const currentAction = withPriority
        ? this.visibleActionsQueue[0] || null
        : this.currentAction || this.visibleActionsQueue[0] || null
      this.#setCurrentAction(currentAction)
      return
    }

    if (withPriority) {
      this.actionsQueue.unshift(newAction)
    } else {
      this.actionsQueue.push(newAction)
    }
    this.sendNewActionMessage(newAction, withPriority ? 'unshift' : 'push')
    const currentAction = withPriority
      ? this.visibleActionsQueue[0] || null
      : this.currentAction || this.visibleActionsQueue[0] || null
    this.#setCurrentAction(currentAction)
  }

  removeAction(actionId: Action['id']) {
    this.actionsQueue = this.actionsQueue.filter((a) => a.id !== actionId)
    this.#setCurrentAction(this.visibleActionsQueue[0] || null)
  }

  #setCurrentAction(nextAction: Action | null) {
    if (nextAction && nextAction.id === this.currentAction?.id) {
      this.openActionWindow()
      this.emitUpdate()
      return
    }

    this.currentAction = nextAction

    if (!this.currentAction) {
      !!this.actionWindow.id && this.#windowManager.remove(this.actionWindow.id)
    } else {
      this.openActionWindow()
    }

    this.emitUpdate()
  }

  setCurrentActionById(actionId: Action['id']) {
    const action = this.visibleActionsQueue.find((a) => a.id === actionId)

    if (!action) return

    this.#setCurrentAction(action)
  }

  setCurrentActionByIndex(actionIndex: number) {
    const action = this.visibleActionsQueue[actionIndex]

    if (!action) return

    this.#setCurrentAction(action)
  }

  sendNewActionMessage(newAction: Action, type: 'push' | 'unshift' | 'update') {
    if (this.visibleActionsQueue.length > 1 && newAction.type !== 'benzin') {
      if (this.actionWindow.loaded) {
        this.#windowManager.sendWindowToastMessage(messageOnNewAction(newAction, type), {
          type: 'success'
        })
      } else {
        this.actionWindow.pendingMessage = {
          message: messageOnNewAction(newAction, type),
          options: { type: 'success' }
        }
      }
    }
  }

  openActionWindow() {
    if (this.actionWindow.id !== null) {
      this.focusActionWindow()
    } else {
      this.#windowManager.open().then((winId) => {
        this.actionWindow.id = winId!
        this.emitUpdate()
      })
    }
  }

  focusActionWindow = () => {
    if (!this.visibleActionsQueue.length || !this.currentAction || !this.actionWindow.id) return
    this.#windowManager.focus(this.actionWindow.id)
  }

  setWindowLoaded() {
    if (!this.actionWindow.id) return
    this.actionWindow.loaded = true

    if (this.actionWindow.pendingMessage) {
      this.#windowManager.sendWindowToastMessage(
        this.actionWindow.pendingMessage.message,
        this.actionWindow.pendingMessage.options
      )
      this.actionWindow.pendingMessage = null
    }
    this.emitUpdate()
  }

  removeAccountData(address: Account['addr']) {
    this.actionsQueue = this.actionsQueue.filter((a) => {
      if (a.type === 'accountOp') {
        return a.accountOp.accountAddr !== address
      }
      if (a.type === 'signMessage') {
        return a.userRequest.meta.accountAddr !== address
      }
      if (a.type === 'benzin') {
        return a.userRequest.meta.accountAddr !== address
      }

      return true
    })

    this.emitUpdate()
  }

  get banners() {
    return getDappActionRequestsBanners(this.visibleActionsQueue)
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      visibleActionsQueue: this.visibleActionsQueue,
      banners: this.banners
    }
  }
}
