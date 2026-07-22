import { EventEmitter as UiEventEmitter } from 'events'

import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IUiController, UiManager, View, isExtensionOverlayView } from '../../interfaces/ui'
import EventEmitter from '../eventEmitter/eventEmitter'

export class UiController extends EventEmitter implements IUiController {
  uiEvent: UiEventEmitter

  views: View[] = []

  window: UiManager['window']

  notification: UiManager['notification']

  message: UiManager['message']

  dispatchDappTabFocus?: UiManager['dispatchDappTabFocus']

  openSidePanel?: UiManager['openSidePanel']

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
    this.dispatchDappTabFocus = uiManager.dispatchDappTabFocus
    this.openSidePanel = uiManager.openSidePanel
  }

  addView(view: View) {
    const existingOverlay = this.views.find((v) => isExtensionOverlayView(v))

    // if an overlay view already exists, just update its id and stop here
    if (isExtensionOverlayView(view) && existingOverlay) {
      existingOverlay.id = view.id
      existingOverlay.type = view.type
      if (!existingOverlay.isReady) this.uiEvent.emit('addView', view)
      this.emitUpdate()
      return
    }

    // if the same view already exists, skip adding
    if (this.views.some((v) => v.id === view.id)) return

    this.views.push(view)
    this.uiEvent.emit('addView', view)
    this.emitUpdate()
  }

  updateView(
    viewId: string,
    updatedProps: Pick<View, 'currentRoute' | 'isReady' | 'searchParams'>
  ) {
    const view = this.views.find((v) => v.id === viewId)
    if (!view) return

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

  removeView(viewId: string) {
    const view = this.views.find((v) => v.id === viewId)

    if (!view) return

    this.views = this.views.filter((v) => v.id !== viewId)

    this.uiEvent.emit('removeView', view)
    this.emitUpdate()
  }

  navigateView(viewId: string, route: string, params: { [key: string]: any }) {
    const view = this.views.find((v) => v.id === viewId)
    if (!view || view.currentRoute === route) return

    view.currentRoute = route
    this.message.sendNavigateMessage(viewId, route, params)
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      uiEvent: undefined,
      window: undefined,
      notification: undefined,
      message: undefined,
      openSidePanel: undefined
    }
  }
}
