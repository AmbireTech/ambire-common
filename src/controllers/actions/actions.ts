/* eslint-disable @typescript-eslint/no-floating-promises */

import { Account } from '../../interfaces/account'
import {
  AccountOpAction,
  Action,
  BenzinAction,
  DappRequestAction,
  SignMessageAction,
  SwitchAccountAction
} from '../../interfaces/actions'
import { NotificationManager } from '../../interfaces/notification'
import { WindowManager } from '../../interfaces/window'
// eslint-disable-next-line import/no-cycle
import { messageOnNewAction } from '../../libs/actions/actions'
import { getDappActionRequestsBanners } from '../../libs/banners/banners'
import { ENTRY_POINT_AUTHORIZATION_REQUEST_ID } from '../../libs/userOperation/userOperation'
import EventEmitter from '../eventEmitter/eventEmitter'
// Kind of inevitable, the AccountsController has SelectedAccountController, which has ActionsController
// eslint-disable-next-line import/no-cycle
import { SelectedAccountController } from '../selectedAccount/selectedAccount'

// TODO: Temporarily. Refactor imports across the codebase to ref /interfaces/actions instead.
export type {
  SwitchAccountAction,
  Action,
  AccountOpAction,
  SignMessageAction,
  BenzinAction,
  DappRequestAction
}

export type ActionPosition = 'first' | 'last'

export type ActionExecutionType = 'queue' | 'queue-but-open-action-window' | 'open-action-window'

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
  #selectedAccount: SelectedAccountController

  #windowManager: WindowManager

  #notificationManager: NotificationManager

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
        return a.accountOp.accountAddr === this.#selectedAccount.account?.addr
      }
      if (a.type === 'signMessage') {
        return a.userRequest.meta.accountAddr === this.#selectedAccount.account?.addr
      }
      if (a.type === 'benzin') {
        return a.userRequest.meta.accountAddr === this.#selectedAccount.account?.addr
      }
      if (a.type === 'switchAccount') {
        return a.userRequest.meta.switchToAccountAddr !== this.#selectedAccount.account?.addr
      }

      return true
    })
  }

  constructor({
    selectedAccount,
    windowManager,
    notificationManager,
    onActionWindowClose
  }: {
    selectedAccount: SelectedAccountController
    windowManager: WindowManager
    notificationManager: NotificationManager
    onActionWindowClose: () => void
  }) {
    super()

    this.#selectedAccount = selectedAccount
    this.#windowManager = windowManager
    this.#notificationManager = notificationManager
    this.#onActionWindowClose = onActionWindowClose

    this.#windowManager.event.on('windowRemoved', async (winId: number) => {
      if (winId === this.actionWindow.id) {
        this.actionWindow.id = null
        this.actionWindow.loaded = false
        this.actionWindow.pendingMessage = null
        this.currentAction = null

        this.actionsQueue = this.actionsQueue.filter((a) => a.type === 'accountOp')
        if (this.actionsQueue.length) {
          await this.#notificationManager.create({
            title:
              this.actionsQueue.length > 1
                ? `${this.actionsQueue.length} transactions queued`
                : 'Transaction queued',
            message: 'Queued pending transactions are available on your Dashboard.'
          })
        }
        this.#onActionWindowClose()
        this.emitUpdate()
      }
    })
  }

  addOrUpdateAction(
    newAction: Action,
    position: ActionPosition = 'last',
    executionType: ActionExecutionType = 'open-action-window'
  ) {
    // remove the benzin action if a new actions is added
    this.actionsQueue = this.actionsQueue.filter((a) => a.type !== 'benzin')
    if (this.currentAction && this.currentAction.type === 'benzin') {
      this.currentAction = null
    }

    const actionIndex = this.actionsQueue.findIndex((a) => a.id === newAction.id)
    if (actionIndex !== -1) {
      this.actionsQueue[actionIndex] = newAction
      if (executionType !== 'queue') {
        let currentAction = null
        if (executionType === 'open-action-window') {
          this.sendNewActionMessage(newAction, 'updated')
          currentAction = this.visibleActionsQueue.find((a) => a.id === newAction.id) || null
        } else if (executionType === 'queue-but-open-action-window') {
          this.sendNewActionMessage(newAction, 'queued')
          currentAction = this.currentAction || this.visibleActionsQueue[0] || null
        }
        this.#setCurrentAction(currentAction)
      } else {
        this.emitUpdate()
      }
      return
    }

    if (position === 'first') {
      this.actionsQueue.unshift(newAction)
    } else {
      this.actionsQueue.push(newAction)
    }

    if (executionType !== 'queue') {
      let currentAction = null
      if (executionType === 'open-action-window') {
        currentAction = this.visibleActionsQueue.find((a) => a.id === newAction.id) || null
      } else if (executionType === 'queue-but-open-action-window') {
        this.sendNewActionMessage(newAction, 'queued')
        currentAction = this.currentAction || this.visibleActionsQueue[0] || null
      }
      this.#setCurrentAction(currentAction)
    } else {
      this.emitUpdate()
    }
  }

  removeAction(actionId: Action['id'], shouldOpenNextAction: boolean = true) {
    this.actionsQueue = this.actionsQueue.filter((a) => a.id !== actionId)
    if (shouldOpenNextAction) {
      this.#setCurrentAction(this.visibleActionsQueue[0] || null)
    }
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
    const action = this.visibleActionsQueue.find((a) => a.id.toString() === actionId.toString())
    if (!action) {
      const entryPointAction = this.visibleActionsQueue.find(
        (a) => a.id.toString() === ENTRY_POINT_AUTHORIZATION_REQUEST_ID
      )

      if (entryPointAction) this.#setCurrentAction(entryPointAction)

      return
    }

    this.#setCurrentAction(action)
  }

  setCurrentActionByIndex(actionIndex: number) {
    const action = this.visibleActionsQueue[actionIndex]

    if (!action) {
      const entryPointAction = this.visibleActionsQueue.find(
        (a) => a.id.toString() === ENTRY_POINT_AUTHORIZATION_REQUEST_ID
      )
      if (entryPointAction) this.#setCurrentAction(entryPointAction)

      return
    }

    this.#setCurrentAction(action)
  }

  sendNewActionMessage(newAction: Action, type: 'queued' | 'updated') {
    if (this.visibleActionsQueue.length > 1 && newAction.type !== 'benzin') {
      if (this.actionWindow.loaded) {
        const message = messageOnNewAction(newAction, type)
        if (message) this.#windowManager.sendWindowToastMessage(message, { type: 'success' })
      } else {
        const message = messageOnNewAction(newAction, type)
        if (message) this.actionWindow.pendingMessage = { message, options: { type: 'success' } }
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

  closeActionWindow = () => {
    if (!this.actionWindow.id) return
    this.#windowManager.remove(this.actionWindow.id)
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
      if (a.type === 'switchAccount') {
        return a.userRequest.meta.switchToAccountAddr !== address
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
