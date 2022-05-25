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

export type UseToastsReturnType = {
  addToast: (text?: string | number, options?: UseToastsOptions) => any
  removeToast: (id: number) => any
}

export interface ToastType extends UseToastsOptions {
  text: string | number
}
