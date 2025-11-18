import EmittableError from '../../classes/EmittableError'
import { Account } from '../../interfaces/account'
import {
  AccountOpAction,
  Action,
  ActionExecutionType,
  ActionPosition,
  OpenActionWindowParams
} from '../../interfaces/actions'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { FocusWindowParams, IUiController, WindowProps } from '../../interfaces/ui'
import { messageOnNewAction } from '../../libs/actions/actions'
import { getDappActionRequestsBanners } from '../../libs/banners/banners'
import EventEmitter from '../eventEmitter/eventEmitter'

const SWAP_AND_BRIDGE_WINDOW_SIZE = {
  width: 640,
  height: 640
}
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
  #selectedAccount: ISelectedAccountController

  #ui: IUiController

  actionWindow: {
    windowProps: WindowProps
    openWindowPromise?: Promise<WindowProps>
    focusWindowPromise?: Promise<WindowProps>
    closeWindowPromise?: Promise<void>
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
    windowProps: null,
    loaded: false,
    pendingMessage: null
  }

  actionsQueue: Action[] = []

  #currentAction: Action | null = null

  #onSetCurrentAction: (currentAction: Action | null) => void

  #onActionWindowClose: () => Promise<void>

  get currentAction() {
    return this.#currentAction
  }

  set currentAction(val: Action | null) {
    this.#currentAction = val
    this.#onSetCurrentAction(val)
  }

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
      if (a.type === 'swapAndBridge' || a.type === 'transfer') {
        return a.userRequest.meta.accountAddr === this.#selectedAccount.account?.addr
      }

      return true
    })
  }

  async #handleActionWindowClose(winId: number) {
    if (
      winId === this.actionWindow.windowProps?.id ||
      (!this.visibleActionsQueue.length && this.currentAction && this.actionWindow.windowProps)
    ) {
      this.actionWindow.windowProps = null
      this.actionWindow.loaded = false
      this.actionWindow.pendingMessage = null
      this.currentAction = null

      this.actionsQueue = this.actionsQueue.filter((a) => a.type === 'accountOp')
      const callsCount = this.actionsQueue.reduce((acc, action) => {
        if (action.type !== 'accountOp') return acc

        return acc + (action.accountOp.calls?.length || 0)
      }, 0)

      if (this.visibleActionsQueue.length) {
        await this.#ui.notification.create({
          title: callsCount > 1 ? `${callsCount} transactions queued` : 'Transaction queued',
          message: 'Queued pending transactions are available on your Dashboard.'
        })
      }
      await this.#onActionWindowClose()
      this.emitUpdate()
    }
  }

  constructor({
    selectedAccount,
    ui,
    onSetCurrentAction,
    onActionWindowClose
  }: {
    selectedAccount: ISelectedAccountController
    ui: IUiController
    onSetCurrentAction: (currentAction: Action | null) => void
    onActionWindowClose: () => Promise<void>
  }) {
    super()

    this.#selectedAccount = selectedAccount
    this.#ui = ui
    this.#onSetCurrentAction = onSetCurrentAction
    this.#onActionWindowClose = onActionWindowClose

    this.#ui.window.event.on('windowRemoved', async (winId: number) => {
      // When windowManager.focus is called, it may close and reopen the action window as part of its fallback logic.
      // To avoid prematurely running the cleanup logic during that transition, we wait for focusWindowPromise to resolve.
      await this.actionWindow.focusWindowPromise

      await this.#handleActionWindowClose(winId)
    })

    this.#ui.window.event.on('windowFocusChange', async (winId: number) => {
      if (this.actionWindow.windowProps) {
        if (this.actionWindow.windowProps.id === winId && !this.actionWindow.windowProps.focused) {
          this.actionWindow.windowProps.focused = true
          this.emitUpdate()
        } else if (
          this.actionWindow.windowProps.id !== winId &&
          this.actionWindow.windowProps.focused
        ) {
          this.actionWindow.windowProps.focused = false
          this.emitUpdate()
        }
      }
    })
  }

  async addOrUpdateActions(
    newActions: Action[],
    {
      position = 'last',
      executionType = 'open-action-window',
      skipFocus = false,
      baseWindowId = undefined
    }: {
      position?: ActionPosition
      executionType?: ActionExecutionType
      skipFocus?: boolean
      baseWindowId?: number
    } = {}
  ) {
    // remove the benzin action if a new actions is added
    this.actionsQueue = this.actionsQueue.filter((a) => {
      if (a.type === 'benzin') return false

      if (a.type === 'switchAccount') {
        return a.userRequest.meta.switchToAccountAddr !== this.#selectedAccount.account?.addr
      }

      return true
    })
    if (this.currentAction && this.currentAction.type === 'benzin') {
      this.currentAction = null
    }

    newActions.forEach((newAction) => {
      const actionIndex = this.actionsQueue.findIndex((a) => a.id === newAction.id)

      if (actionIndex !== -1) {
        this.actionsQueue[actionIndex] = newAction
        if (executionType === 'open-action-window') {
          this.sendNewActionMessage(newAction, 'updated')
        } else if (executionType === 'queue-but-open-action-window') {
          this.sendNewActionMessage(newAction, 'queued')
        }
      } else if (position === 'first') {
        this.actionsQueue.unshift(newAction)
      } else {
        this.actionsQueue.push(newAction)
      }
    })

    const nextAction = newActions[0]

    if (executionType !== 'queue') {
      let currentAction = null
      if (executionType === 'open-action-window') {
        currentAction = this.visibleActionsQueue.find((a) => a.id === nextAction.id) || null
      } else if (executionType === 'queue-but-open-action-window') {
        this.sendNewActionMessage(nextAction, 'queued')
        currentAction = this.currentAction || this.visibleActionsQueue[0] || null
      }
      await this.#setCurrentAction(currentAction, {
        skipFocus,
        baseWindowId
      })
    } else {
      this.emitUpdate()
    }
  }

  updateAccountOpAction(updatedAccountOp: AccountOpAction['accountOp']) {
    const { accountAddr, chainId } = updatedAccountOp
    const accountOpAction = this.actionsQueue.find(
      (a) => a.type === 'accountOp' && a.id === `${accountAddr}-${chainId}`
    )

    if (!accountOpAction || accountOpAction.type !== 'accountOp') return

    accountOpAction.accountOp = updatedAccountOp
    this.emitUpdate()
  }

  async removeActions(actionIds: Action['id'][], shouldOpenNextAction: boolean = true) {
    this.actionsQueue = this.actionsQueue.filter((a) => !actionIds.includes(a.id))

    if (!this.visibleActionsQueue.length) {
      await this.#setCurrentAction(null)
    } else if (shouldOpenNextAction) {
      await this.#setCurrentAction(this.visibleActionsQueue[0], {
        skipFocus: true
      })
    }
  }

  async #awaitPendingPromises() {
    await this.actionWindow.closeWindowPromise
    await this.actionWindow.focusWindowPromise
    await this.actionWindow.openWindowPromise
  }

  async #setCurrentAction(nextAction: Action | null, params?: OpenActionWindowParams) {
    this.currentAction = nextAction
    this.emitUpdate()

    if (nextAction) {
      await this.openActionWindow(params)
      return
    }

    await this.closeActionWindow()
  }

  async setCurrentActionById(actionId: Action['id'], params?: OpenActionWindowParams) {
    const action = this.visibleActionsQueue.find((a) => a.id.toString() === actionId.toString())
    if (!action)
      throw new EmittableError({
        message:
          'Failed to open request window. If the issue persists, please reject the request and try again.',
        level: 'major',
        error: new Error(`Action not found. Id: ${actionId}`)
      })
    await this.#setCurrentAction(action, params)
  }

  async setCurrentActionByIndex(actionIndex: number, params?: OpenActionWindowParams) {
    const action = this.visibleActionsQueue[actionIndex]
    if (!action)
      throw new EmittableError({
        message:
          'Failed to open request window. If the issue persists, please reject the request and try again.',
        level: 'major',
        error: new Error(`Action not found. Index: ${actionIndex}`)
      })
    await this.#setCurrentAction(action, params)
  }

  sendNewActionMessage(newAction: Action, type: 'queued' | 'updated') {
    if (this.visibleActionsQueue.length > 1 && newAction.type !== 'benzin') {
      if (this.actionWindow.loaded) {
        // When the action window is loaded, we don't show messages for dappRequest actions
        // if the current action is also a dappRequest action and is pending to be removed
        if (
          this.currentAction?.type === 'dappRequest' &&
          this.currentAction?.userRequest?.meta.pendingToRemove
        )
          return

        const message = messageOnNewAction(newAction, type)
        if (message) this.#ui.message.sendToastMessage(message, { type: 'success' })
      } else {
        const message = messageOnNewAction(newAction, type)
        if (message) this.actionWindow.pendingMessage = { message, options: { type: 'success' } }
      }
    }
  }

  async openActionWindow(params?: OpenActionWindowParams) {
    const { skipFocus, baseWindowId } = params || {}
    await this.#awaitPendingPromises()

    if (this.actionWindow.windowProps) {
      if (!skipFocus) await this.focusActionWindow()
    } else {
      let customSize

      if (this.currentAction?.type === 'swapAndBridge') {
        customSize = SWAP_AND_BRIDGE_WINDOW_SIZE
      }

      try {
        await this.#ui.window.remove('popup')
        this.actionWindow.openWindowPromise = this.#ui.window
          .open({ customSize, baseWindowId })
          .finally(() => {
            this.actionWindow.openWindowPromise = undefined
          })
        this.actionWindow.windowProps = await this.actionWindow.openWindowPromise

        this.emitUpdate()
      } catch (err) {
        this.emitError({
          message:
            'Failed to open a new request window. Please restart your browser if the issue persists.',
          level: 'major',
          error: err as Error
        })
      }
    }
  }

  async focusActionWindow(params?: FocusWindowParams) {
    await this.#awaitPendingPromises()

    if (!this.visibleActionsQueue.length || !this.currentAction || !this.actionWindow.windowProps)
      return

    try {
      await this.#ui.window.remove('popup')
      this.actionWindow.focusWindowPromise = this.#ui.window
        .focus(this.actionWindow.windowProps, params)
        .finally(() => {
          this.actionWindow.focusWindowPromise = undefined
        })

      const newActionWindowProps = await this.actionWindow.focusWindowPromise

      if (newActionWindowProps) {
        this.actionWindow.windowProps = newActionWindowProps
      }

      this.emitUpdate()
    } catch (err) {
      this.emitError({
        message:
          'Failed to focus the request window. Please restart your browser if the issue persists.',
        level: 'major',
        error: err as Error
      })
    }
  }

  async closeActionWindow() {
    await this.#awaitPendingPromises()

    if (!this.actionWindow.windowProps) return

    this.actionWindow.closeWindowPromise = this.#ui.window
      .remove(this.actionWindow.windowProps.id)
      .finally(() => {
        this.actionWindow.closeWindowPromise = undefined
      })

    await this.actionWindow.closeWindowPromise

    if (!this.actionWindow.windowProps) return

    await this.#handleActionWindowClose(this.actionWindow.windowProps.id)
  }

  setWindowLoaded() {
    if (!this.actionWindow.windowProps) return
    this.actionWindow.loaded = true

    if (this.actionWindow.pendingMessage) {
      this.#ui.message.sendToastMessage(
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
      if (a.type === 'swapAndBridge') {
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
      banners: this.banners,
      currentAction: this.currentAction
    }
  }
}
