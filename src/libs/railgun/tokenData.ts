import { ZeroAddress } from 'ethers'

import { RailgunTokenData } from '../../interfaces/railgun'
import { Portfolio } from '../portfolio'
import { TokenResult } from '../portfolio/interfaces'

/**
 * Whose balances the metadata probe asks for. The deployless `getBalances` contract needs an
 * address to return symbol/decimals alongside a `balanceOf`; the balances themselves are discarded.
 *
 * Deliberately a constant rather than the user's account: the token list here is derived from
 * decrypted shielded notes, so pairing it with the account address would hand the RPC provider the
 * one link the pool exists to hide.
 */
const METADATA_PROBE_ADDRESS = ZeroAddress

/**
 * Symbol decoding failures are soft in the deployless path: `mapToken` catches them and yields
 * 'Unknown' instead of an error, so it has to be treated as one here. Letting it through would
 * label a token "Unknown" and, worse, pair it with whatever `decimals` decoded to - which is what
 * a user-entered amount is parsed with.
 */
const UNRESOLVED_SYMBOL = 'Unknown'

// What the deployless contract returns in a token's error slot when nothing went wrong - empty
// returndata, not an empty string.
const NO_TOKEN_ERROR = '0x'

/**
 * Symbol/decimals for a chain's tokens as the public portfolio already knows them, in the shape
 * `resolveRailgunTokensData` accepts as already-resolved.
 *
 * Not an approximation of the contract read - it IS the same read, through the same deployless
 * `getBalances` and `mapToken`. Every token it covers is one the metadata `eth_call` can skip, and
 * one less request whose token list is derived from decrypted notes. It cannot cover everything: a
 * token with no public balance is filtered out of the portfolio, so a fully shielded one still
 * needs the read.
 */
export const getRailgunTokensDataFromPortfolio = (
  portfolioTokens: TokenResult[],
  chainId: string
): { [address: string]: RailgunTokenData } => {
  const tokensData: { [address: string]: RailgunTokenData } = {}

  portfolioTokens.forEach((token) => {
    if (token.chainId.toString() !== chainId) return
    // Gas Tank and rewards entries are portfolio-level virtual balances, not tokens on this chain.
    if (token.flags.onGasTank || token.flags.rewardsType) return
    // Same guard as on the deployless results below - the portfolio carries `mapToken`'s fallback
    // symbol too, and a token labelled "Unknown" is one whose `decimals` cannot be trusted either.
    if (!token.symbol || token.symbol === UNRESOLVED_SYMBOL) return

    const address = token.address.toLowerCase()

    tokensData[address] = {
      address,
      symbol: token.symbol,
      decimals: token.decimals,
      priceIn: token.priceIn
    }
  })

  return tokensData
}

/**
 * Resolves symbol, decimals and price for the tokens a Railgun pool holds - without them a balance
 * has no label, no way to be formatted and no value.
 *
 * Metadata comes from the portfolio's deployless `getBalances`, which covers a whole list in one
 * `eth_call`. `knownTokensData` is what the caller already resolved: symbol/decimals are immutable
 * and never re-read, prices always are.
 *
 * Never rejects - the balances it decorates are real money that has just been scanned successfully,
 * and a slow price server must not undo that. Failures come back for the caller to log.
 */
export const resolveRailgunTokensData = async ({
  addresses,
  portfolio,
  knownTokensData = {}
}: {
  // Expected lowercased - see the keying note in RailgunController.tokensData.
  addresses: string[]
  // Built against the chain the pool belongs to, so it already carries the network and provider.
  portfolio: Portfolio
  knownTokensData?: { [address: string]: RailgunTokenData }
}): Promise<{
  tokensData: { [address: string]: RailgunTokenData }
  errors: { address: string; message: string }[]
}> => {
  const errors: { address: string; message: string }[] = []

  const resolveMetadata = async (): Promise<{
    [address: string]: Pick<RailgunTokenData, 'symbol' | 'decimals'>
  }> => {
    const metadata: { [address: string]: Pick<RailgunTokenData, 'symbol' | 'decimals'> } = {}

    addresses.forEach((address) => {
      const known = knownTokensData[address]
      if (known) metadata[address] = { symbol: known.symbol, decimals: known.decimals }
    })

    const missingAddresses = addresses.filter((address) => !metadata[address])
    if (!missingAddresses.length) return metadata

    try {
      const results = await portfolio.getTokensByAddresses(
        METADATA_PROBE_ADDRESS,
        missingAddresses,
        { blockTag: 'latest' }
      )

      results.forEach(([error, token]) => {
        const address = token.address.toLowerCase()

        // `'0x'` is the contract's way of saying "no error" - see `isValidToken` in the portfolio
        // lib, which checks the same thing. Treating it as truthy would reject every token.
        if (error !== NO_TOKEN_ERROR || token.symbol === UNRESOLVED_SYMBOL) {
          errors.push({
            address,
            message: `could not read symbol/decimals: ${
              error !== NO_TOKEN_ERROR ? error : 'the contract answered with no symbol'
            }`
          })

          return
        }

        metadata[address] = { symbol: token.symbol, decimals: token.decimals }
      })
    } catch (error: any) {
      errors.push({
        address: missingAddresses.join(','),
        message: `the metadata call failed: ${error?.message || 'unknown error'}`
      })
    }

    return metadata
  }

  const metadata = await resolveMetadata()

  const tokensData: { [address: string]: RailgunTokenData } = {}

  await Promise.all(
    addresses.map(async (address) => {
      // No entry at all rather than one with assumed decimals: `decimals` is what an entered
      // amount is parsed with, and assuming 18 for a 6-decimals token turns "1 USDC" into a
      // million. The consumer treats a missing entry as unresolved and blocks the token in the
      // forms - see getTokenMeta. The price is not even asked for, since a value cannot be
      // computed without decimals anyway.
      const tokenMetadata = metadata[address]
      if (!tokenMetadata) return

      // Mirrors what `Portfolio.getTokenPrice` does with a network that has no CoinGecko platform:
      // returns nothing. That is the normal case on testnets - their tokens have no market - and is
      // why a shielded balance there shows an amount but no value.
      // No `tokenDataCache` is passed: prices are meant to be re-read on every sync, and what keeps
      // that to one request is the batcher inside `portfolio`, which coalesces these concurrent
      // calls into one cena request per 40 tokens.
      const price = await portfolio.getTokenPrice(address).catch((error: any) => {
        errors.push({
          address,
          message: `could not read the price: ${error?.message || 'unknown error'}`
        })

        return undefined
      })

      tokensData[address] = {
        address,
        ...tokenMetadata,
        priceIn: typeof price === 'number' ? [{ baseCurrency: 'usd', price }] : []
      }
    })
  )

  return { tokensData, errors }
}
