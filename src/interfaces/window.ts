import { EventEmitter } from 'events'

export type WindowId = number

export type WindowProps = {
  id: WindowId
  top: number
  left: number
  width: number
  height: number
  focused: boolean
} | null

export interface WindowManager {
  event: EventEmitter
  open: (options?: {
    route?: string
    customSize?: { width: number; height: number }
  }) => Promise<WindowProps>
  focus: (windowProps: WindowProps) => Promise<void>
  remove: (winId: WindowId) => Promise<void>
  sendWindowToastMessage: (
    message: string,
    options?: {
      timeout?: number
      type?: 'error' | 'success' | 'info' | 'warning'
      sticky?: boolean
    }
  ) => void
  sendWindowUiMessage: (params: {}) => void
}
