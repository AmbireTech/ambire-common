import { useCallback, useEffect, useState } from 'react'

import { fetchCaught } from '../../services/fetch'
import {
  ConstantsType,
  ResultEndpointResponse,
  UseConstantsProps,
  UseConstantsReturnType
} from './types'

const useConstants = ({ fetch, endpoint }: UseConstantsProps): UseConstantsReturnType => {
  const [data, setData] = useState<ConstantsType | null>(null)
  const [hasError, setHasError] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const fetchConstants = useCallback(async () => {
    try {
      const [
        { tokenList, humanizerInfo, WALLETInitialClaimableRewards },
        adexToStakingTransfersLogs
      ] = await Promise.all<
        [Promise<ResultEndpointResponse>, Promise<ConstantsType['adexToStakingTransfersLogs']>]
      >([
        fetchCaught(fetch, `${endpoint}/result.json`).then((res) => res.body),
        fetchCaught(fetch, `${endpoint}/adexToStakingTransfers.json`).then((res) => res.body)
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
  }, [fetch, endpoint])

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
