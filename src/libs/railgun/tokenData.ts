import { ZeroAddress } from 'ethers'

import { RailgunTokenData } from '../../interfaces/railgun'
import { Portfolio } from '../portfolio'
import { TokenResult } from '../portfolio/interfaces'

/**
 * Whose balances the metadata probe asks for. The deployless `getBalances` contract returns
 * symbol/decimals/name alongside a `balanceOf`, so it needs an address - but we only want the
 * metadata, and the balances come back as zeros and are discarded.
 *
 * Deliberately a constant rather than the user's account. Unlike cena, the RPC provider is a third
 * party, and this request's token list is derived from decrypted shielded notes - so pairing it
 * with the account address would hand that party the one link the pool exists to hide. With a
 * fixed address the request is identical for every user and links to nobody.
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
 * Worth seeding because these are not an approximation of the contract read - they ARE the same
 * read: the public portfolio gets them from the same deployless `getBalances` call through the same
 * `mapToken`, symbol overrides included. So every token covered here is one the metadata
 * `eth_call` does not have to ask about, and when it covers all of them the call is skipped
 * entirely. It also means one less request whose token list is derived from decrypted notes.
 *
 * It does not cover everything, by design of the portfolio rather than of this: a token with a zero
 * public balance is filtered out of the portfolio (see `tokenFilter`), so a token that was shielded
 * in full still needs the contract read. A partially shielded one does not.
 *
 * Despite coming from the selected account, this is not account-specific data - it is used purely as
 * a source of contract truth, which is identical for every account.
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
 * Resolves what the UI needs to render a shielded balance - symbol, decimals and price - for the
 * tokens a Railgun pool holds. The pool reports raw contract addresses and raw amounts only, so
 * without this a balance has no label, no way to be formatted, and no value.
 *
 * Metadata comes from the portfolio's deployless `getBalances` contract, which returns
 * symbol/decimals for a whole list of tokens in a single `eth_call` - as opposed to a
 * `symbol()` + `decimals()` pair per token, which is what the same information costs over a plain
 * ERC20 contract.
 *
 * `knownTokensData` is what the caller already resolved: symbol and decimals are immutable, so a
 * token that has been resolved once is never asked for again. Prices are re-fetched every time,
 * since that is the part that goes stale.
 *
 * Never rejects. A pool holds real, spendable money whose balances were just scanned
 * successfully; failing that because a price server was slow would be the wrong trade. Failures
 * are returned so the caller can log them.
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
