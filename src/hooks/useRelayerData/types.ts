export interface UseRelayerDataProps {
  fetch: any
  url: string | null | boolean
  initialState?: any
  isOffline?: boolean
}

export interface UseRelayerDataReturnType {
  data: any
  isLoading: boolean
  errMsg: string | null
  forceRefresh: () => void
}
