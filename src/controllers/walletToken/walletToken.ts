import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { RPCProvider } from '../../interfaces/provider'
import { TokenResult } from '../../libs/portfolio/interfaces'
import {
  WALLET_STAKING_CHAIN_ID,
  XWalletShareValueCache,
  xWalletShareValueCache
} from '../../libs/walletStaking/shareValue'
import EventEmitter from '../eventEmitter/eventEmitter'

type WalletTokenBalance = Pick<TokenResult, 'address' | 'amount' | 'amountPostSimulation'>

export type WalletStakingShareValue = {
  shareValue: bigint
  updatedAt: number
}

/** Loads WALLET-token data needed by the portfolio. */
export class WalletTokenController extends EventEmitter {
  #xWalletShareValueCache: Pick<XWalletShareValueCache, 'get'>

  constructor(shareValueCache: Pick<XWalletShareValueCache, 'get'> = xWalletShareValueCache) {
    super()
    this.#xWalletShareValueCache = shareValueCache
  }

  /** Returns the xWALLET conversion rate when the portfolio contains an xWALLET balance. */
  async getWalletStakingShareValue({
    chainId,
    tokens,
    provider
  }: {
    chainId: bigint
    tokens: WalletTokenBalance[]
    provider: RPCProvider
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

      return { shareValue, updatedAt }
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
}
