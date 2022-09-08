import { useEffect, useState } from 'react'

import { fetchGet } from '../../services/fetch'
import { ConstantsType, UseFetchConstantsProps, UseFetchConstantsReturnType } from './types'

const useFetchConstants = ({ fetch }: UseFetchConstantsProps): UseFetchConstantsReturnType => {
  const [data, setData] = useState<ConstantsType | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchConstants = async () => {
      const cacheResp = await fetchGet(fetch, 'https://jason.ambire.com/cache.json')

      if (!cacheResp) {
        setIsLoading(false)
        return
      }

      const cache = cacheResp.result

      if ((typeof cache === 'object' && cache.lastUpdated > Date.now()) || !data) {
        const resultResp = await fetchGet(fetch, 'https://jason.ambire.com/result.json')
        const adexToStakingTransfersLogsResp = await fetchGet(
          fetch,
          'https://jason.ambire.com/adexToStakingTransfers.json'
        )

        if (!resultResp || !adexToStakingTransfersLogsResp) {
          setIsLoading(false)
          return
        }

        const adexToStakingTransfersLogs = adexToStakingTransfersLogsResp.result
        const result = resultResp.result

        setIsLoading(() => {
          setData(
            result && adexToStakingTransfersLogs
              ? {
                  tokenList: result.tokenList,
                  humanizerInfo: result.humanizerInfo,
                  WALLETInitialClaimableRewards: result.WALLETInitialClaimableRewards,
                  adexToStakingTransfersLogs
                }
              : null
          )
          return false
        })
      } else {
        setIsLoading(false)
      }
    }
    fetchConstants()
  }, [fetch, data])

  return {
    constants: data,
    isLoading
  }
}

export default useFetchConstants
