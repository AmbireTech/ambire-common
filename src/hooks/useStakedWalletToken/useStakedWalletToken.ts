import { useCallback, useEffect, useRef, useState } from 'react'

import getStats from './getStats/getStats'
import { UseStakedWalletTokenProps, UseStakedWalletTokenReturnType } from './types'

const useStakedWalletToken = ({
  accountId,
  provider
}: UseStakedWalletTokenProps): UseStakedWalletTokenReturnType => {
  const isMounted = useRef(true)
  const [response, setResponse] = useState({
    isLoading: true,
    error: '',
    stakedAmount: 0
  })

  const getData = useCallback(async () => {
    if (!accountId || !isMounted.current) return

    setResponse({
      stakedAmount: 0,
      isLoading: true,
      error: ''
    })

    try {
      const stakedAmount = await getStats(accountId, provider)

      if (!isMounted.current) return

      setResponse({
        stakedAmount,
        isLoading: false,
        error: ''
      })
    } catch (e) {
      if (!isMounted.current) return

      setResponse({
        stakedAmount: 0,
        isLoading: false,
        error: "Couldn't get staked amount"
      })
    }
  }, [accountId, setResponse, provider])

  useEffect(() => {
    getData()
  }, [getData])

  return response
}

export default useStakedWalletToken
