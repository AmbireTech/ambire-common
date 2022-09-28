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
      const [
        { tokenList, humanizerInfo, WALLETInitialClaimableRewards }
        // adexToStakingTransfersLogs
      ] = await Promise.all<
        // [Promise<ResultEndpointResponse>, Promise<ConstantsType['adexToStakingTransfersLogs']>]
        [Promise<ResultEndpointResponse>]
      >([
        fetchCaught(fetch, `${endpoint}/result.json`).then((res) => res.body)
        // fetchCaught(fetch, `${endpoint}/adexToStakingTransfers.json`).then((res) => res.body)
      ])

      setIsLoading(() => {
        setData({
          tokenList,
          humanizerInfo,
          WALLETInitialClaimableRewards,
          // adexToStakingTransfersLogs,
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

  const getAdexToStakingTransfers = async () => {
    if (adexToStakingTransfers) return adexToStakingTransfers

    try {
      const [adexToStakingTransfersLogs] = await Promise.all<
        [Promise<AdexToStakingTransfersLogsType>]
      >([fetchCaught(fetch, `${endpoint}/adexToStakingTransfers.json`).then((res) => res.body)])

      setAdexToStakingTransfers(adexToStakingTransfersLogs)
      return adexToStakingTransfersLogs
    } catch (e) {
      return null
    }
  }

  return {
    constants: data,
    getAdexToStakingTransfers,
    isLoading,
    retryFetch: fetchConstants,
    hasError
  }
}

export default useConstants
