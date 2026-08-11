import { EventEmitter } from 'events'

import { ControllerInterface } from './controller'

export type IUiController = ControllerInterface<
  InstanceType<typeof import('../controllers/ui//ui').UiController>
>

/** The view type of the window that exists solely to display the current user request. */
export const REQUEST_VIEW_TYPE = 'request-window'

/** Options forwarded to the UI's router when a controller navigates a view. */
export type NavigateOptions = {
  replace?: boolean
  state?: { [key: string]: any }
}

export type View = {
  id: string
  type: typeof REQUEST_VIEW_TYPE | 'tab' | 'popup' | 'mobile'
  /** Where the view reports it actually is. Only the UI writes this. */
  currentRoute?: string
  previousRoute?: string
  /**
   * Where a controller last asked the view to go, while that is still unconfirmed. Cleared as
   * soon as the view reports a route, so a route the UI refused (a redirect guard, for example)
   * can be requested again instead of being deduped away.
   */
  pendingRoute?: string
  isReady?: boolean
  searchParams?: { [key: string]: string }
}

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
    sendNavigateMessage: (viewId: string, route: string, options?: NavigateOptions) => void
  }
  /**
   * Tells where a view should be, based on the state of the controllers its screens depend on.
   * Awaits the initial load of those controllers first, so a `null` answer means the view has
   * nowhere to go, never that the wallet is not ready yet.
   */
  resolveViewRoute: (view: View) => Promise<string | null>
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
