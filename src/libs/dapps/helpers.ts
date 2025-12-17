import { getDomain } from 'tldts'

import { predefinedDapps } from '../../consts/dapps/dapps'
import { Dapp, DefiLlamaProtocol } from '../../interfaces/dapp'

const getDappIdFromUrl = (url: string): string => {
  if (!url || url === 'internal') return 'internal'

  const predefinedDapp = predefinedDapps.find((d) => d.url === url)
  if (predefinedDapp) return predefinedDapp.id

  try {
    const { hostname } = new URL(url)
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname
  } catch {
    return url
  }
}

const getDomainFromUrl = (url: string) => {
  const predefinedDapp = predefinedDapps.find((d) => d.url === url)
  if (predefinedDapp) return predefinedDapp.id

  return getDomain(url)
}

const formatDappName = (name: string) => {
  if (name.toLowerCase().includes('uniswap')) return 'Uniswap'
  if (name.toLowerCase().includes('aave v3')) return 'AAVE'

  return name
}

const sortDapps = (a: Dapp, b: Dapp) => {
  // 1. rewards.ambire.com always first
  if (a.id === 'rewards.ambire.com') return -1
  if (b.id === 'rewards.ambire.com') return 1

  // 2. Snapshot Ambire DAO always second
  if (a.id === 'snapshot.box/#/s:ambire.eth') return -1
  if (b.id === 'snapshot.box/#/s:ambire.eth') return 1

  // 3. Featured first, then by TVL
  const featuredAndTVL =
    Number(b.isFeatured) - Number(a.isFeatured) || Number(b.tvl) - Number(a.tvl)

  if (featuredAndTVL !== 0) return featuredAndTVL

  // 4. Custom dapps last
  return Number(a.isCustom) - Number(b.isCustom)
}

const modifyDappPropsIfNeeded = (
  id: string,
  dappsMap: Map<string, Dapp>,
  protocol: DefiLlamaProtocol,
  onModify: (modifiedDapp: Dapp) => void
) => {
  if (id === 'uniswap.org' || id === 'app.uniswap.org') {
    const uniswap = dappsMap.get(id)
    if (uniswap) {
      uniswap.id = 'app.uniswap.org'
      uniswap.icon = 'https://icons.llama.fi/uniswap-v4.png'
      uniswap.tvl = (uniswap.tvl || 0) + (protocol.tvl || 0)
      uniswap.description =
        'Swap, earn, and build on the leading decentralized crypto trading protocol.'
      onModify(uniswap)
    }
  }
}

function getDappNameFromId(id: string) {
  try {
    return id
      .replace(/^www\./, '')
      .split('.')
      .map((part) =>
        part
          .split('-')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ')
      )
      .join(' ')
  } catch {
    return 'Unknown Dapp'
  }
}

function unifyDefiLlamaDappUrl(url: string) {
  try {
    return new URL(url).origin
  } catch {
    return url // If it's not a valid URL, return as-is
  }
}

export {
  getDappIdFromUrl,
  getDomainFromUrl,
  formatDappName,
  sortDapps,
  modifyDappPropsIfNeeded,
  getDappNameFromId,
  unifyDefiLlamaDappUrl
}
