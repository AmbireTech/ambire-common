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

    this.uiEvent.emit('addView')
    this.emitUpdate()
  }

  updateView(viewId: string, { currentRoute }: Pick<View, 'currentRoute'>) {
    const view = this.views.find((v) => v.id === viewId)
    if (!view || view.currentRoute === currentRoute) return

    view.currentRoute = currentRoute
    this.emitUpdate()
  }

  removeView(viewId: string) {
    this.views = this.views.filter((v) => v.id !== viewId)

    this.uiEvent.emit('removeView')
    this.emitUpdate()
  }

  navigateView(viewId: string, route: string, params: { [key: string]: any }) {
    const view = this.views.find((v) => v.id === viewId)
    if (!view || view.currentRoute === route) return

    view.currentRoute = route
    this.message.sendNavigateMessage(viewId, route, params)
    this.emitUpdate()
  }
}
