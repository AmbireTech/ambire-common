import { Contract, formatUnits, WeiPerEther } from 'ethers'

import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { RPCProvider } from '../../interfaces/provider'
import { TokenResult } from '../portfolio/interfaces'
import formatDecimals from '../../utils/formatDecimals/formatDecimals'
import { withTimeout } from '../../utils/with-timeout'

export const WALLET_STAKING_CHAIN_ID = 1n
export const X_WALLET_SHARE_VALUE_CACHE_TTL = 60 * 60 * 1000
export const X_WALLET_SHARE_VALUE_RPC_TIMEOUT_MS = 6000

const X_WALLET_SHARE_VALUE_ABI = 'function shareValue() view returns (uint256)'
const X_WALLET_LOCKED_SHARES_ABI = 'function lockedShares(address) view returns (uint256)'

export const X_WALLET_LOCKED_SHARES_RPC_TIMEOUT_MS = 6000

export type XWalletShareValueResult = {
  shareValue: bigint
  updatedAt: number
  refreshError?: Error
}

const normalizeError = (error: unknown) =>
  error instanceof Error ? error : new Error('Unable to load the WALLET staking conversion rate.')

/** Calculates the WALLET value represented by an xWALLET amount. */
export const getWalletAmountFromXWallet = (xWalletAmount: bigint, shareValue: bigint) =>
  (xWalletAmount * shareValue) / WeiPerEther

/** Calculates the xWALLET/stkWALLET shares a WALLET amount would convert into (the inverse of {@link getWalletAmountFromXWallet}). */
export const getXWalletAmountFromWallet = (walletAmount: bigint, shareValue: bigint) =>
  shareValue > 0n ? (walletAmount * WeiPerEther) / shareValue : 0n

/**
 * Reads the xWALLET shares the account has already committed to a pending unstake. Those shares
 * stay locked in the staking contract, so only the remainder of the balance can still be migrated.
 * Unlike the share value, this is per account and therefore not cached globally.
 */
export const getXWalletLockedShares = async (provider: RPCProvider, accountAddr: string) => {
  const contract = new Contract(WALLET_STAKING_ADDR, [X_WALLET_LOCKED_SHARES_ABI], provider)
  const getLockedShares = contract.lockedShares
  if (typeof getLockedShares !== 'function') {
    throw new Error('The locked xWALLET shares are unavailable.')
  }

  return BigInt(
    await withTimeout(() => getLockedShares(accountAddr), {
      timeoutMs: X_WALLET_LOCKED_SHARES_RPC_TIMEOUT_MS,
      message: 'The locked xWALLET shares took too long to load.'
    })
  )
}

/** Formats the shared xWALLET-to-WALLET explanation used across the wallet. */
export const getXWalletConversionText = (xWalletAmount: bigint, walletAmount: bigint) => {
  const formattedXWalletAmount = formatDecimals(Number(formatUnits(xWalletAmount, 18)), 'amount')
  const formattedWalletAmount = formatDecimals(Number(formatUnits(walletAmount, 18)), 'amount')

  return `${formattedXWalletAmount} xWALLET = ${formattedWalletAmount} WALLET`
}

/**
 * Shares the global xWALLET conversion rate between portfolio, staking and signing flows.
 * Failed refreshes keep the last successful value and postpone the next attempt for one hour.
 */
export class XWalletShareValueCache {
  #cachedResult?: Omit<XWalletShareValueResult, 'refreshError'>

  #cachedError?: Error

  #expiresAt = 0

  #refreshPromise?: Promise<XWalletShareValueResult>

  async get(provider: RPCProvider): Promise<XWalletShareValueResult> {
    if (Date.now() < this.#expiresAt) {
      if (this.#cachedResult) return this.#cachedResult
      throw this.#cachedError || new Error('Unable to load the WALLET staking conversion rate.')
    }

    if (this.#refreshPromise) return this.#refreshPromise

    const refreshPromise = this.#refresh(provider)
    this.#refreshPromise = refreshPromise

    try {
      return await refreshPromise
    } finally {
      if (this.#refreshPromise === refreshPromise) this.#refreshPromise = undefined
    }
  }

  async #refresh(provider: RPCProvider): Promise<XWalletShareValueResult> {
    try {
      const contract = new Contract(WALLET_STAKING_ADDR, [X_WALLET_SHARE_VALUE_ABI], provider)
      const getShareValue = contract.shareValue
      if (typeof getShareValue !== 'function') {
        throw new Error('The WALLET staking conversion rate is unavailable.')
      }
      const shareValue = BigInt(
        await withTimeout(() => getShareValue(), {
          timeoutMs: X_WALLET_SHARE_VALUE_RPC_TIMEOUT_MS,
          message: 'The WALLET staking conversion rate took too long to load.'
        })
      )

      if (shareValue <= 0n) {
        throw new Error('The WALLET staking conversion rate is unavailable.')
      }

      const updatedAt = Date.now()
      this.#cachedResult = { shareValue, updatedAt }
      this.#cachedError = undefined
      this.#expiresAt = updatedAt + X_WALLET_SHARE_VALUE_CACHE_TTL

      return this.#cachedResult
    } catch (error) {
      const refreshError = normalizeError(error)
      this.#cachedError = refreshError
      this.#expiresAt = Date.now() + X_WALLET_SHARE_VALUE_CACHE_TTL

      if (this.#cachedResult) return { ...this.#cachedResult, refreshError }
      throw refreshError
    }
  }
}

export const xWalletShareValueCache = new XWalletShareValueCache()

type WalletTokenBalance = Pick<TokenResult, 'address' | 'amount' | 'amountPostSimulation'>

export type XWalletLockedSharesGetter = (
  provider: RPCProvider,
  accountAddr: string
) => Promise<bigint>

export type WalletStakingShareValue = {
  shareValue: bigint
  updatedAt: number
  /** Undefined while unknown - the per-account lookup is optional and may fail on its own. */
  lockedShares?: bigint
}

/** An error of the share value lookup, in the shape that controllers emit. */
export type WalletStakingShareValueError = { level: 'silent'; message: string; error: Error }

/**
 * The locked shares are a nice-to-have next to the conversion rate, so a failure here is
 * reported and swallowed rather than dropping the share value the rest of the app relies on.
 */
const getLockedShares = async (
  provider: RPCProvider,
  lockedSharesGetter: XWalletLockedSharesGetter,
  onError: (error: WalletStakingShareValueError) => void,
  accountAddr?: string
): Promise<bigint | undefined> => {
  if (!accountAddr) return undefined

  try {
    return await lockedSharesGetter(provider, accountAddr)
  } catch (error) {
    onError({
      level: 'silent',
      message: 'Unable to load the locked xWALLET shares.',
      error: error instanceof Error ? error : new Error('Unable to load the locked xWALLET shares.')
    })

    return undefined
  }
}

/**
 * Returns the xWALLET conversion rate (and the account's locked shares) when the portfolio
 * contains an xWALLET balance. It never throws: failures are reported through `onError`.
 */
export const getWalletStakingShareValue = async ({
  chainId,
  tokens,
  provider,
  accountAddr,
  onError,
  shareValueCache = xWalletShareValueCache,
  lockedSharesGetter = getXWalletLockedShares
}: {
  chainId: bigint
  tokens: WalletTokenBalance[]
  provider: RPCProvider
  accountAddr?: string
  onError: (error: WalletStakingShareValueError) => void
  shareValueCache?: Pick<XWalletShareValueCache, 'get'>
  lockedSharesGetter?: XWalletLockedSharesGetter
}): Promise<WalletStakingShareValue | null> => {
  if (chainId !== WALLET_STAKING_CHAIN_ID) return null

  const hasXWalletBalance = tokens.some(
    (token) =>
      token.address.toLowerCase() === WALLET_STAKING_ADDR.toLowerCase() &&
      (token.amount > 0n || (token.amountPostSimulation || 0n) > 0n)
  )
  if (!hasXWalletBalance) return null

  try {
    const { shareValue, updatedAt, refreshError } = await shareValueCache.get(provider)

    if (refreshError) {
      onError({
        level: 'silent',
        message: 'Unable to refresh the WALLET staking conversion rate.',
        error: refreshError
      })
    }

    return {
      shareValue,
      updatedAt,
      lockedShares: await getLockedShares(provider, lockedSharesGetter, onError, accountAddr)
    }
  } catch (error) {
    onError({
      level: 'silent',
      message: 'Unable to load the WALLET staking conversion rate.',
      error:
        error instanceof Error
          ? error
          : new Error('Unable to load the WALLET staking conversion rate.')
    })

    return null
  }
}
