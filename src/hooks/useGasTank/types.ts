import { UseStorageType } from '../useStorage'

export type UseGasTankProps = {
  selectedAcc: string
  useStorage: UseStorageType
}

export type GasTankEntryType = {
  account: string
  isEnabled: boolean
}

export type UseGasTankReturnType = {
  gasTankState: GasTankEntryType[]
  setGasTankState: (newGasTankState: GasTankEntryType[]) => void
}
