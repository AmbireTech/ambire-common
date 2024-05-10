import { EventEmitter } from 'events'

export interface WindowManager {
  event: EventEmitter
  open: (route?: string) => Promise<number>
  focus: (windowId: number) => Promise<void>
  remove: (winId: number) => Promise<void>
}
