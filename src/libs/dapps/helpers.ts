import { Dapp } from '../../interfaces/dapp'

const getDappIdFromUrl = (url?: string): string => {
  if (!url) return 'internal'

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
