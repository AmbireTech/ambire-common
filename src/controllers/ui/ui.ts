import { EventEmitter as UiEventEmitter } from 'events'

import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import {
  FocusWindowParams,
  isExtensionOverlayView,
  IUiController,
  OpenWindowOptions,
  UiManager,
  View,
  WindowId,
  WindowProps
} from '../../interfaces/ui'
import EventEmitter from '../eventEmitter/eventEmitter'

function areSearchParamsEqual(a: View['searchParams'], b: View['searchParams']): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b

  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false

  return aKeys.every((key) => a[key] === b[key])
}

/**
 * The surface that shows a request: the panel when it is open (nothing to open, focus or close
 * there), a dedicated request window otherwise. Consumers only open, focus and close.
 */
type RequestViewManager = {
  open: (options?: OpenWindowOptions) => Promise<WindowProps>
  focus: (windowProps: WindowProps, params?: FocusWindowParams) => Promise<WindowProps>
  close: (winId: WindowId) => Promise<void>
}

export class UiController extends EventEmitter implements IUiController {
  uiEvent: UiEventEmitter

  views: View[] = []

  window: UiManager['window']

  panel: UiManager['panel']

  notification: UiManager['notification']

  message: UiManager['message']

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

    const shouldUpdate = Object.entries(updatedProps).some(([key, value]) => {
      // searchParams is a plain object rebuilt by the caller on every dispatch,
      // so a reference check always reports a change. Compare it by value.
      if (key === 'searchParams') {
        return !areSearchParamsEqual(view.searchParams, value as View['searchParams'])
      }

      return view[key as keyof View] !== value
    })
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
      panel: undefined,
      notification: undefined,
      message: undefined,
      dispatchDappTabFocus: undefined,
      requestView: undefined
    }
  }
}
