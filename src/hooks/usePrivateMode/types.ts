import { UseStorageProps, UseStorageReturnType } from '../useStorage'

export type UsePrivateModeProps = {
  useStorage: (p: Omit<UseStorageProps, 'storage'>) => UseStorageReturnType
}

export type UsePrivateModeReturnType = {
  isPrivateMode: boolean
  hidePrivateValue: (value: string | number) => string | number
  togglePrivateMode: () => void
}
