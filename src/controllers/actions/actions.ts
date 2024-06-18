/* eslint-disable @typescript-eslint/no-floating-promises */

import { DappUserRequest, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { getDappActionRequestsBanners } from '../../libs/banners/banners'
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
  selectedAccount: string | null

  #windowManager: WindowManager

  actionWindowId: number | null = null

  actionsQueue: Action[] = []

  currentAction: Action | null = null

  #onActionWindowClose: () => void

  get visibleActionsQueue(): Action[] {
    return (
      this.actionsQueue.map((a) => {
        if (a.type === 'accountOp') {
          return a.accountOp.accountAddr === this.selectedAccount ? a : undefined
        }
        if (a.type === 'signMessage') {
          return a.userRequest.meta.accountAddr === this.selectedAccount ? a : undefined
        }
        if (a.type === 'benzin') {
          return a.userRequest.meta.accountAddr === this.selectedAccount ? a : undefined
        }

        return a
      }) as (Action | undefined)[]
    ).filter(Boolean) as Action[]
  }

  constructor({
    selectedAccount,
    windowManager,
    onActionWindowClose
  }: {
    selectedAccount: string | null
    windowManager: WindowManager
    onActionWindowClose: () => void
  }) {
    super()

    this.selectedAccount = selectedAccount
    this.#windowManager = windowManager
    this.#onActionWindowClose = onActionWindowClose

    this.#windowManager.event.on('windowRemoved', (winId: number) => {
      if (winId === this.actionWindowId) {
        this.#onActionWindowClose()
        this.actionWindowId = null
        this.currentAction = null

        this.actionsQueue = this.actionsQueue.filter((a) => !['benzin'].includes(a.type))
        this.emitUpdate()
      }
    })
  }

  update({ selectedAccount }: { selectedAccount?: string | null }) {
    if (selectedAccount) this.selectedAccount = selectedAccount

    this.emitUpdate()
  }

  addOrUpdateAction(newAction: Action, withPriority?: boolean) {
    const actionIndex = this.actionsQueue.findIndex((a) => a.id === newAction.id)
    if (actionIndex !== -1) {
      this.actionsQueue[actionIndex] = newAction
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
      if (this.actionWindowId && newAction.type !== 'benzin') {
        this.#windowManager.sendWindowToastMessage('A new action request was added to the queue.', {
          type: 'success'
        })
      }
    }
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
      !!this.actionWindowId && this.#windowManager.remove(this.actionWindowId)
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
    if (!this.visibleActionsQueue.length || !this.currentAction || !this.actionWindowId) return
    this.#windowManager.focus(this.actionWindowId)
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
