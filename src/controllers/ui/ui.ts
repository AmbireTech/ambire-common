import { EventEmitter as UiEventEmitter } from 'events'

import { IUiController, UiManager, View } from '../../interfaces/ui'
import EventEmitter from '../eventEmitter/eventEmitter'

export class UiController extends EventEmitter implements IUiController {
  uiEvent: UiEventEmitter

  views: View[] = []

  activeView?: View

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

    this.uiEvent.emit('addView')
    this.emitUpdate()
  }

  removeView(viewId: string) {
    this.views = this.views.filter((v) => v.id !== viewId)

    this.uiEvent.emit('removeView')
    this.emitUpdate()
  }

  navigateView(viewId: string, route: string) {
    const view = this.views.find((v) => v.id === viewId)

    if (!view) return

    if (view.currentRoute === route) return

    // TODO: this.#navigate(route)
  }
}
