import { useCallback } from 'react'

import { UsePrivateModeProps, UsePrivateModeReturnType } from './types'

export default function usePrivateMode({
  useStorage
}: UsePrivateModeProps): UsePrivateModeReturnType {
  const [isPrivateMode, setIsPrivateMode] = useStorage({ key: 'isPrivateMode' })

  const togglePrivateMode = useCallback(() => {
    setIsPrivateMode(!isPrivateMode)
  }, [isPrivateMode, setIsPrivateMode])

  const hidePrivateValue = useCallback(
    (value: string | number) => {
      if (!isPrivateMode) {
        return value
      }

      return typeof value === 'string' && value.startsWith('0x') ? value.replace(/./gi, '*') : '**'
    },
    [isPrivateMode]
  )

  return {
    isPrivateMode,
    hidePrivateValue,
    togglePrivateMode
  }
}
