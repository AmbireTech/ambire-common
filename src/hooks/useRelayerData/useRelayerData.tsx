import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchCaught } from '../../services/fetch'
import { UseRelayerDataProps, UseRelayerDataReturnType } from './types'

// Threshold after a load of another URL is triggered, we will clear the data
// so that the component that uses this hook can display the loading spinner.
const RESET_DATA_AFTER = 250

// TODO: Figure out if hook is the best approach for implementing this one.
// TODO: Figure out if a package like https://use-http.com will fit better
export default function useRelayerData({
  fetch,
  url,
  initialState = null
}: UseRelayerDataProps): UseRelayerDataReturnType {
  const [isLoading, setLoading] = useState<boolean>(true)
  const [data, setData] = useState<any>(initialState)
  const [err, setErr] = useState<any>(null)
  const prevUrl = useRef('')

  const updateData = useCallback(async () => {
    const { resp, body, errMsg } = await fetchCaught(fetch, url)
    if (resp && resp.status === 200) {
      return body
    }
    throw new Error(errMsg || `status code ${resp && resp.status}`)
  }, [url])

  useEffect(() => {
    if (!url || typeof url !== 'string') return

    // Data reset: if some time passes before we load the next piece of data, and the URL is different,
    // we will reset the data so that the UI knows to display a loading indicator
    let resetDataTimer: any = null
    const stripQuery = (x: any) => x.split('?')[0]
    if (stripQuery(prevUrl.current) !== stripQuery(url)) {
      resetDataTimer = setTimeout(() => setData(initialState), RESET_DATA_AFTER)
    }
    prevUrl.current = url

    let unloaded = false
    setLoading(true)
    setErr(null)
    updateData()
      .then((d: any) => !unloaded && prevUrl.current === url && setData(d))
      .catch((e) => !unloaded && setErr(e.message || e))
      .then(() => {
        clearTimeout(resetDataTimer)
        !unloaded && setLoading(false)
      })
    return () => {
      unloaded = true
      clearTimeout(resetDataTimer)
    }
  }, [url, updateData])

  // In case we want to refetch the data without changing the url prop
  // e.g. pull to refresh
  const forceRefresh = useCallback(() => {
    if (!url || typeof url !== 'string') return

    // Data reset: if some time passes before we load the next piece of data, and the URL is different,
    // we will reset the data so that the UI knows to display a loading indicator
    const resetDataTimer: any = setTimeout(() => setData(initialState), RESET_DATA_AFTER)
    setLoading(true)
    setErr(null)
    updateData()
      .then((d: any) => prevUrl.current === url && setData(d))
      .catch((e) => setErr(e.message || e))
      .then(() => {
        clearTimeout(resetDataTimer)
        setLoading(false)
      })
  }, [updateData, url])

  return { data, isLoading, errMsg: err, forceRefresh }
}
