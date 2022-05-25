import React from 'react'

type OptionsProps = {
  id: number
  url?: string
  error?: boolean
  sticky?: boolean
  badge?: null | JSX.Element
  timeout?: number
  onClick?: () => any
}

export type UseToastsReturnType = {
  addToast: (text?: string | number, options?: OptionsProps) => any
  removeToast: (id: number) => any
}
