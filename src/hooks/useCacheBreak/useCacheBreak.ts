import { useEffect, useState } from 'react'

export interface UseCacheBreakReturnType {
  cacheBreak: number
}

export default function useCacheBreak(
  breakPoint: number = 5000,
  refreshInterval: number = 30000
): UseCacheBreakReturnType {
  const [cacheBreak, setCacheBreak] = useState(() => Date.now())

  useEffect(() => {
    if (Date.now() - cacheBreak > breakPoint) setCacheBreak(Date.now())
    const intvl = setTimeout(() => setCacheBreak(Date.now()), refreshInterval)

    return () => clearTimeout(intvl)
  }, [cacheBreak])

  return {
    cacheBreak
  }
}
