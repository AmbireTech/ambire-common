import { useCallback } from 'react'

import { GasTankEntryType, UseGasTankProps, UseGasTankReturnType } from './types'

export default function useGasTank({
  selectedAcc,
  useStorage
}: UseGasTankProps): UseGasTankReturnType {
  const defaultGasTankState: GasTankEntryType[] = [{ account: selectedAcc, isEnabled: false }]
  const [state, setState] = useStorage<GasTankEntryType[]>({
    key: 'gasTankState',
    defaultValue: defaultGasTankState
  })

  const setGasTankState = useCallback(
    (newGasTankState: GasTankEntryType[]) => {
      setState(newGasTankState)
    },
    [setState]
  )

  return {
    gasTankState: state,
    setGasTankState
  }
}
