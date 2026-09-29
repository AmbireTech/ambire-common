import { ZeroAddress } from 'ethers'
import { getAddress } from 'viem'

import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import humanizerInfoRaw from '../../consts/humanizer/humanizerInfo.json'
import { Network } from '../../interfaces/network'
import { overrideSymbol } from './helpers'
import { GetOptions, KnownTokenInfo, SuspectedType, TokenResult } from './interfaces'

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

/**
 * Signs of real-world (fiat) currencies. Scam tokens put them in their symbol, e.g. "$" or
 * "€500", so that a received amount looks like cash. Crypto signs such as "₿" are left out
 * on purpose.
 */
export const FIAT_CURRENCY_SIGNS: ReadonlySet<string> = new Set([
  '$',
  '¢',
  '£',
  '¥',
  '€',
  '₹',
  '₽',
  '₩',
  '₺',
  '₴',
  '₦',
  '₱',
  '₪',
  '₫',
  '₡',
  '₲',
  '₵',
  '₸',
  '₼',
  '฿',
  '﷼'
])

/**
 * ISO 4217 codes of widely used fiat currencies. A token whose whole symbol is one of them
 * pretends to be that currency. KRW, CAD and PLN are left out on purpose, because real tokens
 * (KROWN, Caduceus Protocol, PLEARN) use them as their symbol.
 */
export const FIAT_CURRENCY_CODES: ReadonlySet<string> = new Set([
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'CHF',
  'AUD',
  'NZD',
  'HKD',
  'SGD',
  'INR',
  'RUB',
  'TRY',
  'BRL',
  'MXN',
  'ZAR',
  'SEK',
  'NOK',
  'DKK',
  'UAH',
  'AED'
])

/**
 * Characters that take no visible space. Scam symbols put them inside a word (e.g. "U\u200BSD")
 * so that it looks the same but does not match an exact comparison.
 */
const INVISIBLE_CHARS: ReadonlySet<string> = new Set([
  '\u00AD', // soft hyphen
  '\u034F', // combining grapheme joiner
  '\u180E', // Mongolian vowel separator
  '\u200B', // zero-width space
  '\u200C', // zero-width non-joiner
  '\u200D', // zero-width joiner
  '\u200E', // left-to-right mark
  '\u200F', // right-to-left mark
  '\u2060', // word joiner
  '\u2061', // function application
  '\u2062', // invisible times
  '\u2063', // invisible separator
  '\u2064', // invisible plus
  '\uFEFF' // zero-width no-break space
])

/**
 * Removes only invisible characters. Unlike `removeNonLatinChars`, it keeps visible
 * non-ASCII characters, so "USD₮" stays "USD₮" and does not become "USD".
 */
const removeInvisibleChars = (str: string): string =>
  [...str].filter((char) => !INVISIBLE_CHARS.has(char)).join('')

const isAsciiDigit = (char: string) => char >= '0' && char <= '9'

/** Separators that written amounts use between digit groups, e.g. "1,000.50" or "1.000,50". */
const NUMBER_SEPARATORS: ReadonlySet<string> = new Set(['.', ','])

/**
 * Returns true when the text reads as a plain amount, e.g. "1000", "1.000", "1,000",
 * "1.000,1" or "1,000.0". It must start and end with a digit, and a separator must be
 * followed by a digit (so "1..0", ".5" and "5." are not amounts).
 */
const isNumberLike = (text: string): boolean => {
  const chars = [...text]
  if (!chars.length) return false
  if (!isAsciiDigit(chars[0]!) || !isAsciiDigit(chars[chars.length - 1]!)) return false

  return chars.every(
    (char, index) =>
      isAsciiDigit(char) || (NUMBER_SEPARATORS.has(char) && isAsciiDigit(chars[index + 1] ?? ''))
  )
}

/**
 * Short size suffixes that written amounts use, e.g. "100K", "1.5M", "2B" or "1T"
 * (thousand, million, billion, trillion). Compared in uppercase, so "100k" also counts.
 */
const AMOUNT_SUFFIXES: ReadonlySet<string> = new Set(['K', 'M', 'B', 'T'])

/**
 * Returns true when the text reads as an amount: a plain number (see `isNumberLike`),
 * optionally followed by one size suffix, e.g. "100", "100K", "1.5M" or "2 B".
 */
const isAmountLike = (text: string): boolean => {
  const chars = [...text]
  const lastChar = chars[chars.length - 1]
  if (!lastChar || !AMOUNT_SUFFIXES.has(lastChar.toUpperCase())) return isNumberLike(text)

  return isNumberLike(chars.slice(0, -1).join('').trimEnd())
}

/** Returns true when the text is an amount ("100", "1.5M") or a fiat currency code ("USD"). */
const isAmountOrFiatCode = (text: string): boolean =>
  isAmountLike(text) || FIAT_CURRENCY_CODES.has(text.toUpperCase())

/**
 * Returns true when the symbol is a fiat currency sign alone ("$", "€"), or a sign as the
 * first or last character with an amount or a fiat currency code as the rest ("$100",
 * "1.000€", "$ 1,000.50", "$100K", "$USD", "EUR€").
 * A sign next to other text, e.g. "$PEPE" or "US$", is not flagged, because real tokens use it.
 */
const isFiatSignWithAmountOrCode = (symbol: string): boolean => {
  const chars = [...symbol]
  if (!chars.length) return false

  const firstChar = chars[0]!
  const lastChar = chars[chars.length - 1]!
  if (chars.length === 1) return FIAT_CURRENCY_SIGNS.has(firstChar)

  const isSignThenAmountOrCode =
    FIAT_CURRENCY_SIGNS.has(firstChar) && isAmountOrFiatCode(chars.slice(1).join('').trim())
  const isAmountOrCodeThenSign =
    FIAT_CURRENCY_SIGNS.has(lastChar) && isAmountOrFiatCode(chars.slice(0, -1).join('').trim())

  return isSignThenAmountOrCode || isAmountOrCodeThenSign
}

/**
 * Returns true when a token symbol looks like real money: it is exactly a fiat currency
 * code (e.g. "USD"), a fiat currency sign alone (e.g. "$"), or a sign before or after an
 * amount or a fiat currency code (e.g. "$100", "1.000€", "$100K", "$USD").
 * Checks the raw symbol, because `removeNonLatinChars` drops most currency signs.
 * NFKC folds look-alike variants such as the full-width "＄" into their plain form.
 */
export const isFiatLikeSymbol = (symbol: string): boolean => {
  if (!symbol) return false

  const normalizedSymbol = symbol.normalize('NFKC').trim()
  // Hidden characters (e.g. "U\u200BSD" or "$\u200B100") must not hide a fiat-like symbol.
  // Only invisible characters are removed, so a visible sign such as the "₮" in "USD₮" still counts.
  const symbolWithoutHiddenChars = removeInvisibleChars(normalizedSymbol).trim()
  if (FIAT_CURRENCY_CODES.has(symbolWithoutHiddenChars.toUpperCase())) return true

  return isFiatSignWithAmountOrCode(symbolWithoutHiddenChars)
}

/**
 * A single check that can mark a not-trusted token as suspected.
 * Returns the reason when the token matches the rule, otherwise null.
 */
type SuspicionRule = (address: string, symbol: string, chainId: bigint) => SuspectedType

/**
 * The suspicion checks, in order of priority. The first reason found is used.
 * To add a new kind of suspicious token, add a rule here.
 */
const SUSPICION_RULES: SuspicionRule[] = [
  // Same-symbol spoofing on same chain (different address)
  (address, symbol, chainId) =>
    isSuspectedRegardsKnownAddresses(address, symbol, chainId) ? 'suspected' : null,
  // Symbol that pretends to be real money
  (_address, symbol) => (isFiatLikeSymbol(symbol) ? 'suspected' : null)
]

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

  // 3) Run the suspicion rules in order and return the first reason found
  for (const rule of SUSPICION_RULES) {
    const reason = rule(address, symbol, chainId)
    if (reason) return reason
  }

  // 4) Not flagged
  return null
}

let feeTokenIndex: Map<string, (typeof gasTankFeeTokens)[number]> | null = null

const feeTokenKey = (address: string, chainId: string) => `${address.toLowerCase()}|${chainId}`

const getFeeTokenIndex = () => {
  if (feeTokenIndex) return feeTokenIndex

  feeTokenIndex = new Map<string, (typeof gasTankFeeTokens)[number]>()

  gasTankFeeTokens.forEach((feeToken) => {
    const key = feeTokenKey(feeToken.address, feeToken.chainId.toString())

    if (!feeTokenIndex!.has(key)) feeTokenIndex!.set(key, feeToken)
  })

  return feeTokenIndex
}

/**
 * Look up a gas-tank fee token by address and chain in O(1)
 */
export function getFeeToken(
  address: string,
  chainid: bigint
): (typeof gasTankFeeTokens)[number] | undefined {
  return getFeeTokenIndex().get(feeTokenKey(address, chainid.toString()))
}

export function getFlags(
  networkData: any,
  chainId: string,
  tokenChainId: bigint,
  address: string,
  name: string,
  symbol: string,
  hasSimulationAmount?: boolean
): TokenResult['flags'] {
  const isRewardsOrGasTank = ['gasTank', 'rewards'].includes(chainId)
  const onGasTank = chainId === 'gasTank'

  let rewardsType: TokenResult['flags']['rewardsType'] = null
  if (networkData?.stkWalletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-rewards'
  if (networkData?.walletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-vesting'

  const foundFeeToken = getFeeToken(address, tokenChainId)

  const canTopUpGasTank = !!foundFeeToken && !foundFeeToken?.disableGasTankDeposit && !rewardsType
  const isFeeToken =
    address === ZeroAddress ||
    // disable if not in gas tank
    (foundFeeToken && !foundFeeToken.disableAsFeeToken) ||
    chainId === 'gasTank'

  let suspectedType: SuspectedType = null

  if (hasSimulationAmount && !isRewardsOrGasTank) {
    suspectedType = isSuspectedToken(address, symbol, BigInt(chainId))
  }

  return {
    onGasTank,
    rewardsType,
    canTopUpGasTank,
    isFeeToken,
    isHidden: false,
    suspectedType
  }
}

export const mapToken = (
  token: Pick<TokenResult, 'amount' | 'decimals' | 'name' | 'symbol'>,
  network: Network,
  address: string,
  opts: Pick<GetOptions, 'specialErc20Hints' | 'blockTag'>,
  hasSimulationAmount?: boolean,
  latestAmount?: bigint
) => {
  const { specialErc20Hints, blockTag } = opts

  let symbol = 'Unknown'
  try {
    symbol = overrideSymbol(address, network.chainId, token.symbol)
  } catch (e: any) {
    console.log(`no symbol was found for token with address ${address} on ${network.name}`)
  }

  let tokenName = symbol
  try {
    tokenName = token.name
  } catch (e: any) {
    console.log(
      `no name was found for a token with a symbol of: ${symbol}, address: ${address} on ${network.name}`
    )
  }

  const tokenFlags: TokenResult['flags'] = getFlags(
    {},
    network.chainId.toString(),
    network.chainId,
    address,
    tokenName,
    symbol,
    hasSimulationAmount
  )

  if (specialErc20Hints) {
    if (specialErc20Hints.custom.includes(address)) {
      tokenFlags.isCustom = true
    }
    if (specialErc20Hints.hidden.includes(address)) {
      tokenFlags.isHidden = true
    }
  }

  const tokenResult = {
    amount: token.amount,
    chainId: network.chainId,
    decimals: Number(token.decimals),
    name:
      address === '0x0000000000000000000000000000000000000000'
        ? network.nativeAssetName
        : tokenName,
    symbol:
      address === '0x0000000000000000000000000000000000000000' ? network.nativeAssetSymbol : symbol,
    address,
    flags: tokenFlags
  } as TokenResult

  if (blockTag !== 'both') return tokenResult

  return {
    ...tokenResult,
    // Fallback to the pending amount if latestAmount is not provided
    // Otherwise it will look like someone is receiving tokens and the current amount is 0
    // It's important that we are using ?? here instead of ||
    // because latestAmount can be 0
    latestAmount: latestAmount ?? token.amount,
    pendingAmount: tokenResult.amount
  }
}
