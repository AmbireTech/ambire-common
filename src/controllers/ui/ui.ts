import { EventEmitter as UiEventEmitter } from 'events'

import { IUiController, View } from '../../interfaces/ui'
import { WindowManager } from '../../interfaces/window'
import EventEmitter from '../eventEmitter/eventEmitter'

export class UiController extends EventEmitter implements IUiController {
  uiEvent: UiEventEmitter

  views: View[] = []

  activeView?: View

  windowManager: WindowManager

  constructor({ windowManager }: { windowManager: WindowManager }) {
    super()

    this.uiEvent = new UiEventEmitter()
    this.windowManager = windowManager
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
