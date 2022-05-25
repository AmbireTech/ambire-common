import React from 'react'

export type UseToastsOptions = {
  id: number
  url?: string
  error?: boolean
  sticky?: boolean
  badge?: JSX.Element
  timeout?: number
  onClick?: () => any
}

export interface ToastType extends UseToastsOptions {
  text: string | number
}

export type UseToastsReturnType = {
  addToast: (text?: ToastType['text'], options?: UseToastsOptions) => ToastType['id']
  removeToast: (id: ToastType['id']) => void
}
