import { UseStorageProps, UseStorageReturnType } from '../useStorage'

export type UseGasTankProps = {
  selectedAcc: string
  useStorage: (p: Omit<UseStorageProps, 'storage'>) => UseStorageReturnType
}

export type GasTankEntryType = {
  account: string
  isEnabled: boolean
}

export type UseGasTankReturnType = {
  gasTankState: GasTankEntryType[]
  setGasTankState: (newGasTankState: GasTankEntryType[]) => void
}
