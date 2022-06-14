export interface UseRelayerDataReturnType {
  data: any
  isLoading: boolean
  errMsg: string | null
  forceRefresh: () => void
}
