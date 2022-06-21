export type UseToastsOptions = {
  id: number
  url?: string
  error?: boolean
  sticky?: boolean
  badge?: number | string
  timeout?: number
  onClick?: () => any
}

export interface ToastType extends UseToastsOptions {
  text: string | number
}

export type UseToastsReturnType = {
  addToast: (text: ToastType['text'], options?: Omit<UseToastsOptions, 'id'>) => ToastType['id']
  removeToast: (id: ToastType['id']) => void
}
