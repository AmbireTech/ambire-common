import { getDomain } from 'tldts'

import { Dapp } from '../../interfaces/dapp'

const getDappIdFromUrl = (url?: string, dapps?: Dapp[]): string => {
  if (!url) return 'internal'

  try {
    if (dapps) {
      const domain = getDomain(url)
      console.log('domain', url, domain)
      const existingDapp = dapps.find((d) => d.id === domain)
      console.log('existingDapp', existingDapp)
      if (existingDapp) return existingDapp.id
    }
  } catch (error) {
    // silent fail
  }

  try {
    const { hostname } = new URL(url)
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname
  } catch {
    return url
  }
}

const formatDappName = (name: string) => {
  if (name.toLowerCase().includes('uniswap')) return 'Uniswap'
  if (name.toLowerCase().includes('aave v3')) return 'AAVE'

  return name
}

const getIsLegacyDappStructure = (d: Dapp) => {
  const keys = ['chainIds', 'tvl', 'category'] as const
  return keys.every((key) => d[key] === undefined)
}

export { getDappIdFromUrl, formatDappName, getIsLegacyDappStructure }
