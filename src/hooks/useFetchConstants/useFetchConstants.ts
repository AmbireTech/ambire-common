import { useCallback, useEffect, useState } from 'react'

import { fetchGet } from '../../services/fetch'
import { ConstantsType, UseFetchConstantsProps, UseFetchConstantsReturnType } from './types'

const useFetchConstants = ({ fetch }: UseFetchConstantsProps): UseFetchConstantsReturnType => {
  const [data, setData] = useState<ConstantsType | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchConstants = useCallback(async () => {
    const endpoint = 'https://jason.ambire.com/'
    const cacheResp = await fetchGet(fetch, `${endpoint}cache.json`)

    if (!cacheResp) {
      setIsLoading(false)
      return
    }

    const cache = cacheResp.result

    if ((typeof cache === 'object' && cache.lastUpdated > Date.now()) || !data) {
      const result = await fetchGet(fetch, `${endpoint}result.json`)
      const adexToStakingTransfersLogs = await fetchGet(
        fetch,
        `${endpoint}adexToStakingTransfers.json`
      )

      if (!result || !adexToStakingTransfersLogs) {
        setIsLoading(false)
        return
      }

      setIsLoading(() => {
        setData({
          tokenList: result.tokenList,
          humanizerInfo: result.humanizerInfo,
          WALLETInitialClaimableRewards: result.WALLETInitialClaimableRewards,
          adexToStakingTransfersLogs,
          lastFetched: Date.now()
        })
        return false
      })
    } else {
      setIsLoading(false)
    }
  }, [data, fetch])

  useEffect(() => {
    fetchConstants()
  }, [fetch, data, fetchConstants])

  return {
    constants: data,
    isLoading,
    retryFetch: fetchConstants
  }
}

export default useFetchConstants
