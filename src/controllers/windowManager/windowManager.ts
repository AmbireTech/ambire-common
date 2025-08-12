import { EventEmitter as WindowEventEmitter } from 'events'

import { IWindowManagerController, WindowManager } from '../../interfaces/window'
import EventEmitter from '../eventEmitter/eventEmitter'

export class WindowManagerController extends EventEmitter implements IWindowManagerController {
  views: { id: number; type: 'window' | 'tab' | 'popup' }[] = []

  event!: WindowEventEmitter

  open!: WindowManager['open']

  focus!: WindowManager['focus']

  closePopupWithUrl!: WindowManager['closePopupWithUrl']

  remove!: WindowManager['remove']

  sendWindowToastMessage!: WindowManager['sendWindowToastMessage']

  sendWindowUiMessage!: WindowManager['sendWindowUiMessage']

  constructor({ windowManager }: { windowManager: WindowManager }) {
    super()

    Object.assign(this, windowManager)
  }

  addView(view: { id: number; type: 'window' | 'tab' | 'popup' }) {
    this.views.push(view)

    this.event.emit('addView')
    this.emitUpdate()
  }

  removeView(viewId: number) {
    this.views = this.views.filter((v) => v.id !== viewId)

    this.event.emit('removeView')
    this.emitUpdate()
  }
}
