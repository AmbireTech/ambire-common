import { useCallback, useEffect, useState } from 'react'

import { fetchCaught } from '../../services/fetch'
import { ConstantsType, UseFetchConstantsProps, UseFetchConstantsReturnType } from './types'

const useFetchConstants = ({ fetch }: UseFetchConstantsProps): UseFetchConstantsReturnType => {
  const [data, setData] = useState<ConstantsType | null>(null)
  const [hasError, setHasError] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const fetchConstants = useCallback(async () => {
    const endpoint = 'https://jason.ambire.com/'

    try {
      const [{ tokenList, humanizerInfo, WALLETInitialClaimableRewards}, adexToStakingTransfersLogs] = await Promise.all([
        fetchCaught(fetch, `${endpoint}result.json`).then((res) => res.body),
        fetchCaught(fetch, `${endpoint}adexToStakingTransfers.json`).then((res) => res.body)
      ])

      setIsLoading(() => {
        setData({
          tokenList: tokenList,
          humanizerInfo: humanizerInfo,
          WALLETInitialClaimableRewards: WALLETInitialClaimableRewards,
          adexToStakingTransfersLogs: adexToStakingTransfersLogs,
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
  }, [data, fetch])

  useEffect(() => {
    fetchConstants()
  }, [fetch, data, fetchConstants])

  return {
    constants: data,
    isLoading,
    retryFetch: fetchConstants,
    hasError
  }
}

export default useFetchConstants
