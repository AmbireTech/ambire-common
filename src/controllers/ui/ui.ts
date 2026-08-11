import { EventEmitter as UiEventEmitter } from 'events'

import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IUiController, NavigateOptions, UiManager, View } from '../../interfaces/ui'
import EventEmitter from '../eventEmitter/eventEmitter'

/** A route can carry search params (benzin), while a view reports its path alone. */
const getRoutePath = (route: string) => route.split('?')[0] ?? route

export class UiController extends EventEmitter implements IUiController {
  uiEvent: UiEventEmitter

  views: View[] = []

  window: UiManager['window']

  notification: UiManager['notification']

  message: UiManager['message']

  #resolveViewRoute: UiManager['resolveViewRoute']

  /**
   * Prevents race conditions with routing
   */
  #latestViewRouteSyncTokens: Map<string, number> = new Map()

  #viewRouteSyncTokenCounter = 0

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
    this.notification = uiManager.notification
    this.message = uiManager.message
    this.#resolveViewRoute = uiManager.resolveViewRoute
  }

  addView(view: View) {
    const existingPopup = this.views.find((v) => v.type === 'popup')

    // if a popup already exists, just update its id and stop here
    if (view.type === 'popup' && existingPopup) {
      existingPopup.id = view.id
      // A reopened popup starts at its root, so the route the previous one was on must not be
      // taken for where this one already is.
      delete existingPopup.currentRoute
      delete existingPopup.pendingRoute
      delete existingPopup.searchParams
      this.emitUpdate()
    } else {
      // if the same view already exists, skip adding
      if (this.views.some((v) => v.id === view.id)) return

      this.views.push(view)
      this.uiEvent.emit('addView', view)
      this.emitUpdate()
    }

    this.syncViewRoute(view.id)
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
  async syncViewRoute(viewId: string) {
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

      this.navigateView(viewId, route, { replace: true })
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
      notification: undefined,
      message: undefined
    }
  }
}
