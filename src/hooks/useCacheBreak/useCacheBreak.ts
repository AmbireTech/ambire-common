import React, { useEffect, useState } from 'react'

export interface UseCacheBreakReturnType {
  cacheBreak: number
  setCacheBreak: React.Dispatch<React.SetStateAction<number>>
}

type UseCacheBreakProps = {
  breakPoint: number
  refreshInterval: number
}

export default function useCacheBreak(
  props: UseCacheBreakProps = {
    breakPoint: 5000,
    refreshInterval: 30000
  }
): UseCacheBreakReturnType {
  const [cacheBreak, setCacheBreak] = useState(() => Date.now())

  useEffect(() => {
    const { breakPoint, refreshInterval } = props

    if (Date.now() - cacheBreak > breakPoint) setCacheBreak(Date.now())
    const intvl = setTimeout(() => setCacheBreak(Date.now()), refreshInterval)

    return () => clearTimeout(intvl)
  }, [cacheBreak])

  return {
    cacheBreak,
    setCacheBreak
  }
}
