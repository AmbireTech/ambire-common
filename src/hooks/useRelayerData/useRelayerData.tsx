import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchCaught } from '../../services/fetch'

// 250ms after we've triggered a load of another URL, we will clear the data
//  so that the component that uses this hook can display the loading spinner
const RESET_DATA_AFTER = 250

export default function useRelayerData(fetch: any, url: string | null) {
  const [isLoading, setLoading] = useState<boolean>(true)
  const [data, setData] = useState<any>(null)
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
    if (!url) return

    // Data reset: if some time passes before we load the next piece of data, and the URL is different,
    // we will reset the data so that the UI knows to display a loading indicator
    let resetDataTimer: any = null
    const stripQuery = (x: any) => x.split('?')[0]
    if (stripQuery(prevUrl.current) !== stripQuery(url)) {
      resetDataTimer = setTimeout(() => setData(null), RESET_DATA_AFTER)
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
  const forceRefresh = () => {
    if (!url) return

    // Data reset: if some time passes before we load the next piece of data, and the URL is different,
    // we will reset the data so that the UI knows to display a loading indicator
    const resetDataTimer: any = setTimeout(() => setData(null), RESET_DATA_AFTER)
    setLoading(true)
    setErr(null)
    updateData()
      .then((d: any) => prevUrl.current === url && setData(d))
      .catch((e) => setErr(e.message || e))
      .then(() => {
        clearTimeout(resetDataTimer)
        setLoading(false)
      })
  }

  return { data, isLoading, errMsg: err, forceRefresh }
}
