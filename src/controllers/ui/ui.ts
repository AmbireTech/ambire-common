import { EventEmitter as UiEventEmitter } from 'events'

import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import {
  FocusWindowParams,
  isExtensionOverlayView,
  IUiController,
  NavigateOptions,
  OpenWindowOptions,
  UiManager,
  View,
  WindowId,
  WindowProps
} from '../../interfaces/ui'
import EventEmitter from '../eventEmitter/eventEmitter'

/**
 * The surface that shows a request: the panel when it is open (nothing to open, focus or close
 * there), a dedicated request window otherwise. Consumers only open, focus and close.
 */
type RequestViewManager = {
  open: (options?: OpenWindowOptions) => Promise<WindowProps>
  focus: (windowProps: WindowProps, params?: FocusWindowParams) => Promise<WindowProps>
  close: (winId: WindowId) => Promise<void>
}

/** A route can carry search params (benzin), while a view reports its path alone. */
const getRoutePath = (route: string) => route.split('?')[0] ?? route

export class UiController extends EventEmitter implements IUiController {
  uiEvent: UiEventEmitter

  views: View[] = []

  window: UiManager['window']

  panel: UiManager['panel']

  notification: UiManager['notification']

  message: UiManager['message']

  #resolveViewRoute: UiManager['resolveViewRoute']

  /**
   * Prevents race conditions with routing
   */
  #latestViewRouteSyncTokens: Map<string, number> = new Map()

  #viewRouteSyncTokenCounter = 0
  dispatchDappTabFocus?: UiManager['dispatchDappTabFocus']

  requestView: RequestViewManager

  constructor({
    eventEmitterRegistry,
    uiManager
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    uiManager: UiManager
  }) {
    super(eventEmitterRegistry)

    this.uiEvent = new UiEventEmitter()
    this.window = uiManager.window
    this.panel = uiManager.panel
    this.notification = uiManager.notification
    this.message = uiManager.message
    this.#resolveViewRoute = uiManager.resolveViewRoute
    this.dispatchDappTabFocus = uiManager.dispatchDappTabFocus

    this.requestView = {
      open: async (options?: OpenWindowOptions) => {
        if (this.panel?.isOpen()) return null

        // The popup can't stay open next to a request window
        await this.window.remove('popup')

        return this.window.open(options)
      },
      focus: async (windowProps: WindowProps, params?: FocusWindowParams) => {
        await this.window.remove('popup')

        return this.window.focus(windowProps, params)
      },
      close: (winId: WindowId) => this.window.remove(winId)
    }
  }

  addView(view: View) {
    const existingOverlay = this.views.find((v) => isExtensionOverlayView(v))

    // if an overlay view already exists, just update its id and stop here
    if (isExtensionOverlayView(view) && existingOverlay) {
      existingOverlay.id = view.id
      existingOverlay.type = view.type
      delete existingOverlay.currentRoute
      delete existingOverlay.pendingRoute
      delete existingOverlay.searchParams
      if (!existingOverlay.isReady) this.uiEvent.emit('addView', view)
      this.emitUpdate()
    } else {
      if (this.views.find((v) => v.id === view.id)) return

      this.views.push(view)
      this.uiEvent.emit('addView', view)
      this.emitUpdate()
    }

    // This navigates the new view to its initial route
    this.syncViewRoute(view.id, { isInitialNavigation: true })
  }

  updateView(
    viewId: string,
    updatedProps: Pick<View, 'currentRoute' | 'isReady' | 'searchParams'>
  ) {
    const view = this.views.find((v) => v.id === viewId)
    if (!view) return

    if ('currentRoute' in updatedProps) {
      delete view.pendingRoute
    }

    // @ts-expect-error
    const shouldUpdate = Object.entries(updatedProps).some(([key, value]) => view[key] !== value)
    if (!shouldUpdate) return

    let previousRoute = view.previousRoute
    if (updatedProps.currentRoute && updatedProps.currentRoute !== view.currentRoute) {
      previousRoute = view.currentRoute
    }

    Object.assign(view, updatedProps)

    if (previousRoute) {
      view.previousRoute = previousRoute
    }

    this.uiEvent.emit('updateView', view)
    this.emitUpdate()
  }

  emitViewFocus(viewId: string) {
    const view = this.views.find((v) => v.id === viewId)
    if (!view) return

    this.uiEvent.emit('viewFocus', view)
  }

  removeView(viewId: string) {
    const view = this.views.find((v) => v.id === viewId)

    if (!view) return

    this.views = this.views.filter((v) => v.id !== viewId)
    this.#latestViewRouteSyncTokens.delete(viewId)

    this.uiEvent.emit('removeView', view)
    this.emitUpdate()
  }

  /**
   * Navigates the application to a route in a view, if it is not already there.
   */
  navigateView(viewId: string, route: string, options?: NavigateOptions) {
    const view = this.views.find((v) => v.id === viewId)
    if (!view) return

    const routePath = getRoutePath(route)
    if (view.currentRoute === routePath || view.pendingRoute === routePath) return

    view.pendingRoute = routePath
    this.message.sendNavigateMessage(viewId, route, options)
    this.emitUpdate()
  }

  /**
   * Sends a view to the route its state calls for, if it has not been navigated already.
   * Examples:
   * - Sending to keystore unlock if locked
   * - Moving between request windows when switching requests
   */
  async syncViewRoute(viewId: string, options?: Pick<NavigateOptions, 'isInitialNavigation'>) {
    try {
      const view = this.views.find((v) => v.id === viewId)
      if (!view) return

      this.#viewRouteSyncTokenCounter += 1
      const syncToken = this.#viewRouteSyncTokenCounter
      this.#latestViewRouteSyncTokens.set(viewId, syncToken)

      const route = await this.#resolveViewRoute(view)

      // A newer sync of the same view started while we were resolving, so its answer wins.
      if (this.#latestViewRouteSyncTokens.get(viewId) !== syncToken) return

      if (!route) return

      this.navigateView(viewId, route, {
        replace: true,
        isInitialNavigation: options?.isInitialNavigation
      })
    } catch (e: any) {
      this.emitError({
        level: 'silent',
        message: 'Error: ui.syncViewRoute() failed.',
        error: e
      })
    }
  }

  /** Syncs the route of every view, or of every view of one type. */
  async syncViewRoutes(filterByType?: View['type']) {
    const views = filterByType ? this.views.filter((v) => v.type === filterByType) : this.views

    await Promise.all(views.map((v) => this.syncViewRoute(v.id)))
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      uiEvent: undefined,
      window: undefined,
      panel: undefined,
      notification: undefined,
      message: undefined,
      dispatchDappTabFocus: undefined,
      requestView: undefined
    }
  }
}
