import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { RPCProvider } from '../../interfaces/provider'
import { TokenResult } from '../../libs/portfolio/interfaces'
import {
  getXWalletLockedShares,
  WALLET_STAKING_CHAIN_ID,
  XWalletShareValueCache,
  xWalletShareValueCache
} from '../../libs/walletStaking/shareValue'
import EventEmitter from '../eventEmitter/eventEmitter'

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

/** Loads WALLET-token data needed by the portfolio. */
export class WalletTokenController extends EventEmitter {
  #xWalletShareValueCache: Pick<XWalletShareValueCache, 'get'>

  #getXWalletLockedShares: XWalletLockedSharesGetter

  constructor(
    shareValueCache: Pick<XWalletShareValueCache, 'get'> = xWalletShareValueCache,
    lockedSharesGetter: XWalletLockedSharesGetter = getXWalletLockedShares
  ) {
    super()
    this.#xWalletShareValueCache = shareValueCache
    this.#getXWalletLockedShares = lockedSharesGetter
  }

  /** Returns the xWALLET conversion rate when the portfolio contains an xWALLET balance. */
  async getWalletStakingShareValue({
    chainId,
    tokens,
    provider,
    accountAddr
  }: {
    chainId: bigint
    tokens: WalletTokenBalance[]
    provider: RPCProvider
    accountAddr?: string
  }): Promise<WalletStakingShareValue | null> {
    if (chainId !== WALLET_STAKING_CHAIN_ID) return null

    const hasXWalletBalance = tokens.some(
      (token) =>
        token.address.toLowerCase() === WALLET_STAKING_ADDR.toLowerCase() &&
        (token.amount > 0n || (token.amountPostSimulation || 0n) > 0n)
    )
    if (!hasXWalletBalance) return null

    try {
      const { shareValue, updatedAt, refreshError } =
        await this.#xWalletShareValueCache.get(provider)

      if (refreshError) {
        this.emitError({
          level: 'silent',
          message: 'Unable to refresh the WALLET staking conversion rate.',
          error: refreshError
        })
      }

      return {
        shareValue,
        updatedAt,
        lockedShares: await this.#getLockedShares(provider, accountAddr)
      }
    } catch (error) {
      const shareValueError =
        error instanceof Error
          ? error
          : new Error('Unable to load the WALLET staking conversion rate.')
      this.emitError({
        level: 'silent',
        message: 'Unable to load the WALLET staking conversion rate.',
        error: shareValueError
      })

      return null
    }
  }

  /**
   * The locked shares are a nice-to-have next to the conversion rate, so a failure here is
   * reported and swallowed rather than dropping the share value the rest of the app relies on.
   */
  async #getLockedShares(provider: RPCProvider, accountAddr?: string) {
    if (!accountAddr) return undefined

    try {
      return await this.#getXWalletLockedShares(provider, accountAddr)
    } catch (error) {
      this.emitError({
        level: 'silent',
        message: 'Unable to load the locked xWALLET shares.',
        error:
          error instanceof Error ? error : new Error('Unable to load the locked xWALLET shares.')
      })

      return undefined
    }
  }
}
