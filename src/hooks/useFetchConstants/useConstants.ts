import {
  ConstantsType,
  UseConstantsProps,
  UseConstantsReturnType
} from 'ambire-common/src/hooks/useFetchConstants/types'
import { fetchCaught } from 'ambire-common/src/services/fetch'
import { useCallback, useEffect, useState } from 'react'

const useConstants = ({ fetch }: UseConstantsProps): UseConstantsReturnType => {
  const endpoint = 'https://jason.ambire.com/'
  const [data, setData] = useState<ConstantsType | null>(null)
  const [hasError, setHasError] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const fetchConstants = useCallback(async () => {
    try {
      const [
        { tokenList, humanizerInfo, WALLETInitialClaimableRewards },
        adexToStakingTransfersLogs
      ] = await Promise.all([
        fetchCaught(fetch, `${endpoint}result.json`).then((res) => res.body),
        fetchCaught(fetch, `${endpoint}adexToStakingTransfers.json`).then((res) => res.body)
      ])

      setIsLoading(() => {
        setData({
          tokenList,
          humanizerInfo,
          WALLETInitialClaimableRewards,
          adexToStakingTransfersLogs,
          lastFetched: Date.now()
        })
        setHasError(false)
        return false
      })
    } catch (e) {
      setHasError(true)
      setData(null)
      setIsLoading(false)
    }
  }, [fetch])

  useEffect(() => {
    fetchConstants()
  }, [fetchConstants])

  return {
    constants: data,
    isLoading,
    retryFetch: fetchConstants,
    hasError
  }
}

export default useConstants
