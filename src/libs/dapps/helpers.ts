import { getDomain } from 'tldts'

import { predefinedDapps } from '../../consts/dapps/dapps'
import {
  ConnectionSource,
  Dapp,
  DefiLlamaProtocol,
  RawTrendingToken,
  TrendingToken
} from '../../interfaces/dapp'

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

  if (id === 'zora.co') {
    const zora = dappsMap.get(id)
    if (zora) {
      zora.name = 'Zora'
      zora.description =
        "The world's attention market. Trade any trending topic, idea, meme, or moment."
      onModify(zora)
    }
  }

  if (id === 'app.ipor.io') {
    const fusionByIpor = dappsMap.get(id)
    if (fusionByIpor) {
      fusionByIpor.description =
        'Onchain vault infrastructure for institutional-grade yield. Explore existing strategies in the Fusion App and start earning.'
      onModify(fusionByIpor)
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

/**
 * Returns the list of all accounts that should be returned to a dapp based on the dapp's
 * account preferences.
 */
export function getAccountsForDapp(
  preferences: Dapp['accountPreferences'],
  extensionSelectedAccountAddr: string | undefined
): string[] {
  // Always prioritize the extension-selected account if it's in the dapp's allowed accounts, or if no account is currently selected in the dapp
  if (preferences?.enabled) {
    const selectedAccount = preferences.accounts.includes(extensionSelectedAccountAddr || '')
      ? extensionSelectedAccountAddr || preferences.selectedAccount
      : preferences.selectedAccount
    const otherAccounts = preferences.accounts.filter((acc) => acc !== selectedAccount)

    return [selectedAccount, ...otherAccounts]
  }

  return extensionSelectedAccountAddr ? [extensionSelectedAccountAddr] : []
}

// Reconcile a dapp to the per-source connection invariant: `connectedSources` is the source of
// truth and `isConnected` is always derived from it. Records written before per-source support
// (or by a code path that updated only one of the two fields) can drift; this collapses them back.
function normalizeDappConnection(dapp: Dapp): Dapp {
  const connectedSources = Array.isArray(dapp.connectedSources)
    ? dapp.connectedSources
    : ((dapp.isConnected ? ['injected'] : []) as ConnectionSource[])

  return { ...dapp, connectedSources, isConnected: connectedSources.length > 0 }
}

// Maps the raw cena trending response to the minimal, UI-ready shape kept in state.
// Items without a usable id or price are dropped — they can't be keyed or displayed meaningfully.
function normalizeTrendingTokens(raw: RawTrendingToken[]): TrendingToken[] {
  return raw
    .filter((token) => !!token?.id && typeof token?.data?.price === 'number')
    .map((token) => ({
      id: token.id,
      name: token.name,
      symbol: token.symbol,
      icon: token.large || token.small || token.thumb || '',
      priceUSD: token.data!.price!,
      priceChange24hUSD:
        typeof token.data?.price_change_percentage_24h?.usd === 'number'
          ? token.data.price_change_percentage_24h.usd
          : null,
      marketCapRank: token.market_cap_rank ?? null,
      marketCap: token.data?.market_cap ?? null,
      totalVolume: token.data?.total_volume ?? null,
      description: token.data?.content?.description ?? null
    }))
}

export {
  getDappIdFromUrl,
  getDomainFromUrl,
  formatDappName,
  sortDapps,
  modifyDappPropsIfNeeded,
  getDappNameFromId,
  unifyDefiLlamaDappUrl,
  normalizeDappConnection,
  normalizeTrendingTokens
}
