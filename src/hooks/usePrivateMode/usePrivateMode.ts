import { UsePrivateModeProps, UsePrivateModeReturnType } from './types'

export default function usePrivateMode({
  useStorage
}: UsePrivateModeProps): UsePrivateModeReturnType {
  const [isPrivateMode, setIsPrivateMode] = useStorage({ key: 'isPrivateMode' })

  const togglePrivateMode = () => {
    setIsPrivateMode(!isPrivateMode)
  }

  const hidePrivateValue = (value: string | number) => {
    if (!isPrivateMode) {
      return value
    }

    return typeof value === 'string' && value.startsWith('0x') ? value.replace(/./gi, '*') : '**'
  }

  return {
    isPrivateMode,
    hidePrivateValue,
    togglePrivateMode
  }
}
