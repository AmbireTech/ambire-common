import { EventEmitter as UiEventEmitter } from 'events'

import { IUiController, UiManager, View } from '../../interfaces/ui'
import EventEmitter from '../eventEmitter/eventEmitter'

export class UiController extends EventEmitter implements IUiController {
  uiEvent: UiEventEmitter

  views: View[] = []

  window: UiManager['window']

  notification: UiManager['notification']

  message: UiManager['message']

  constructor({ uiManager }: { uiManager: UiManager }) {
    super()

    this.uiEvent = new UiEventEmitter()
    this.window = uiManager.window
    this.notification = uiManager.notification
    this.message = uiManager.message
  }

  addView(view: View) {
    this.views.push(view)

    this.uiEvent.emit('addView', view)
    this.emitUpdate()
  }

  updateView(viewId: string, updatedProps: Pick<View, 'currentRoute' | 'isReady'>) {
    const view = this.views.find((v) => v.id === viewId)
    if (!view) return

    // @ts-ignore
    const shouldUpdate = Object.entries(updatedProps).some(([key, value]) => view[key] !== value)
    if (!shouldUpdate) return

    Object.assign(view, updatedProps)
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
      message: undefined
    }
  }
}
