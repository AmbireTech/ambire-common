import { UseStorageType } from '../useStorage'

export type UsePrivateModeProps = {
  useStorage: UseStorageType
}

export type UsePrivateModeReturnType = {
  isPrivateMode: boolean
  hidePrivateValue: (value: string | number) => string | number
  togglePrivateMode: () => void
}
