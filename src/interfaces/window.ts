import { EventEmitter } from 'events'

export type WindowId = number | 'popup'

export type WindowProps = {
  id: WindowId
  top: number
  left: number
  width: number
  height: number
  focused: boolean
  createdFromWindowId?: number
} | null

export interface WindowManager {
  event: EventEmitter
  open: (options?: {
    route?: string
    customSize?: { width: number; height: number }
    baseWindowId?: number
  }) => Promise<WindowProps>
  focus: (windowProps: WindowProps) => Promise<WindowProps>
  closePopupWithUrl: (url: string) => Promise<void>
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
