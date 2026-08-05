import { getAddress } from 'viem'

import humanizerInfoRaw from '../../consts/humanizer/humanizerInfo.json'
import { KnownTokenInfo, SuspectedType } from './interfaces'

// A separate file so humanizerInfo.json doesn't end up in the UI bundle
const knownAddresses: { [addr: string]: KnownTokenInfo } = humanizerInfoRaw.knownAddresses || {}

const removeNonLatinChars = (str: string): string =>
  str
    // normalize to NFC form to unify visually-similar composed characters
    .normalize('NFC')
    .split('')
    // keep only ASCII range (printable chars)
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code >= 32 && code <= 126
    })
    .join('')

// safe address normalizer
const normalizeAddress = (addr: string) => {
  try {
    return getAddress(addr)
  } catch {
    return addr
  }
}

export const isSuspectedRegardsKnownAddresses = (
  tokenAddr: string,
  tokenSymbol: string,
  chainId: bigint
): boolean => {
  if (!knownAddresses || !tokenAddr || !tokenSymbol) return false

  const normalizedAddr = normalizeAddress(tokenAddr)
  const normalizedSymbol = removeNonLatinChars(tokenSymbol).toUpperCase()
  const numericChainId = Number(chainId)

  const knownTokens = Object.values(knownAddresses)

  // Only consider known tokens that have chainIds defined (skip those without chainIds)
  return knownTokens.some((known: any) => {
    const knownSymbolRaw = known?.token?.symbol
    const knownChains = known?.chainIds
    if (!knownSymbolRaw || !knownChains) return false // skip unknowns or entries without chainIds

    const knownSymbol = removeNonLatinChars(knownSymbolRaw).toUpperCase()
    if (knownSymbol !== normalizedSymbol) return false

    if (!knownChains.includes(numericChainId)) return false

    // same symbol + same chain but different address -> suspected spoof
    return normalizeAddress(known.address) !== normalizedAddr
  })
}

export const isSuspectedToken = (
  address: string,
  symbol: string,
  chainId: bigint
): SuspectedType => {
  const normalizedAddr = normalizeAddress(address)
  const numericChainId = Number(chainId)

  // 1) lookup known token by address
  const knownToken = knownAddresses?.[normalizedAddr]

  // 2) Only auto-accept if known token exists AND chainIds is defined AND includes chainId
  if (knownToken?.chainIds?.includes(numericChainId)) {
    return null // trusted
  }

  // 3) Same-symbol spoofing on same chain (different address)
  if (isSuspectedRegardsKnownAddresses(address, symbol, chainId)) return 'suspected'

  // 4) Not flagged
  return null
}
