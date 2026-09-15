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

type KnownTokenBySymbol = { address?: string; chainIds: number[] }

/**
 * The known tokens that carry both a symbol and the chains they live on, grouped by
 * their symbol. Built once, because the catalog runs to ten thousand entries and
 * normalizing every one of their symbols to compare against a single token took ~3ms -
 * paid per token of every simulation. The catalog ships with the app and never changes,
 * so a built index can never go stale.
 */
let knownTokensBySymbol: Map<string, KnownTokenBySymbol[]> | null = null

const getKnownTokensBySymbol = () => {
  if (knownTokensBySymbol) return knownTokensBySymbol

  knownTokensBySymbol = new Map<string, KnownTokenBySymbol[]>()

  Object.values(knownAddresses).forEach((known) => {
    const knownSymbolRaw = known?.token?.symbol
    const knownChains = known?.chainIds
    // Unknowns and entries without chainIds are the ones the scan this replaces skipped
    if (!knownSymbolRaw || !knownChains) return

    const knownSymbol = removeNonLatinChars(knownSymbolRaw).toUpperCase()
    const sameSymbol = knownTokensBySymbol!.get(knownSymbol)
    const entry = { address: known.address, chainIds: knownChains }

    if (sameSymbol) sameSymbol.push(entry)
    else knownTokensBySymbol!.set(knownSymbol, [entry])
  })

  return knownTokensBySymbol
}

export const isSuspectedRegardsKnownAddresses = (
  tokenAddr: string,
  tokenSymbol: string,
  chainId: bigint
): boolean => {
  if (!knownAddresses || !tokenAddr || !tokenSymbol) return false

  const normalizedSymbol = removeNonLatinChars(tokenSymbol).toUpperCase()
  const knownTokensWithSameSymbol = getKnownTokensBySymbol().get(normalizedSymbol)

  if (!knownTokensWithSameSymbol) return false

  const normalizedAddr = normalizeAddress(tokenAddr)
  const numericChainId = Number(chainId)

  // same symbol + same chain but different address -> suspected spoof. An entry
  // without an address cannot be shown to be this token, so it counts as a different
  // one - as it did in the scan this replaces.
  return knownTokensWithSameSymbol.some(
    (known) =>
      known.chainIds.includes(numericChainId) &&
      !(!!known.address && normalizeAddress(known.address) === normalizedAddr)
  )
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
