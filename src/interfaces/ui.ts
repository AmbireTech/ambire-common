import { EventEmitter } from 'events'

import { ControllerInterface } from './controller'

export type IUiController = ControllerInterface<
  InstanceType<typeof import('../controllers/ui//ui').UiController>
>

export type View = { id: string; type: 'action-window' | 'tab' | 'popup'; currentRoute?: string }

export type UiManager = {
  window: {
    event: EventEmitter
    open: (options?: {
      route?: string
      customSize?: { width: number; height: number }
      baseWindowId?: number
    }) => Promise<WindowProps>
    focus: (windowProps: WindowProps, params?: FocusWindowParams) => Promise<WindowProps>
    remove: (winId: WindowId | 'popup') => Promise<void>
    closePopupWithUrl: (url: string) => Promise<void> // remove window of type popup
  }
  notification: {
    create: ({
      title,
      message,
      icon
    }: {
      title: string
      message: string
      icon?: string
    }) => Promise<void>
  }
  message: {
    sendToastMessage: (
      message: string,
      options?: {
        timeout?: number
        type?: 'error' | 'success' | 'info' | 'warning'
        sticky?: boolean
      }
    ) => void
    sendUiMessage: (params: {}) => void
    sendNavigateMessage: (route: string, params?: any) => void
  }
}

export type WindowId = number

export type WindowProps = {
  id: WindowId
  top: number
  left: number
  width: number
  height: number
  focused: boolean
  createdFromWindowId?: number
} | null

export type FocusWindowParams = {
  /**
   * In some cases, the passed window cannot be focused (e.g., on Arc browser). If the window cannot be focused
   * within 1 second, a new window is created and the old one is removed.
   */
  reopenIfNeeded?: boolean
}
