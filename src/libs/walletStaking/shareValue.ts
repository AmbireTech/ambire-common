import { Contract, formatUnits, WeiPerEther } from 'ethers'

import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { RPCProvider } from '../../interfaces/provider'
import formatDecimals from '../../utils/formatDecimals/formatDecimals'

export const WALLET_STAKING_CHAIN_ID = 1n
export const X_WALLET_SHARE_VALUE_CACHE_TTL = 60 * 60 * 1000

const X_WALLET_SHARE_VALUE_ABI = 'function shareValue() view returns (uint256)'

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
      const shareValue = BigInt(await getShareValue())

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
