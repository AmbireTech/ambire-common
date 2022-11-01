import { useCallback, useEffect, useState } from 'react'

import { fetchCaught } from '../../services/fetch'
import {
  AdexToStakingTransfersLogsType,
  ConstantsType,
  ResultEndpointResponse,
  UseConstantsProps,
  UseConstantsReturnType
} from './types'

const useConstants = ({ fetch, endpoint }: UseConstantsProps): UseConstantsReturnType => {
  const [data, setData] = useState<ConstantsType | null>(null)
  const [adexToStakingTransfers, setAdexToStakingTransfers] =
    useState<AdexToStakingTransfersLogsType | null>(null)
  const [hasError, setHasError] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const fetchConstants = useCallback(async () => {
    try {
      const response = await fetchCaught<ResultEndpointResponse>(
        fetch,
        `${endpoint}/result.json`
      ).then((res) => res.body)

      if (!response) throw new Error('Failed to get the constants.')

      const { tokenList, humanizerInfo } = response

      setIsLoading(() => {
        setData({
          tokenList,
          humanizerInfo,
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

  const getAdexToStakingTransfersLogs = async () => {
    if (adexToStakingTransfers) return adexToStakingTransfers

    try {
      const adexToStakingTransfersLogs = await fetchCaught<AdexToStakingTransfersLogsType>(
        fetch,
        `${endpoint}/adexToStakingTransfers.json`
      ).then((res) => res.body || null)

      setAdexToStakingTransfers(adexToStakingTransfersLogs)
      return adexToStakingTransfersLogs
    } catch (e) {
      return null
    }
  }

  return {
    constants: data,
    getAdexToStakingTransfersLogs,
    isLoading,
    retryFetch: fetchConstants,
    hasError
  }
}

export default useConstants
