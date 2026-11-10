import { ZeroAddress } from 'ethers'
import { getAddress } from 'viem'

import { getFeeToken } from '@/libs/portfolio/tokenProcessing'

import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import NFTGetter from '../../../contracts/compiled/NFTGetter.json'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { TokenPricesService } from '../../services/tokenPrices/tokenPrices'
import { paginate } from '../../utils/paginate'
import { Deployless, fromDescriptor } from '../deployless/deployless'
import { isBlacklistedAsset, prepareBlacklistPatterns, STATIC_BLACKLIST } from './blacklist'
import { portfolioDebugLog } from './debug'
import { PORTFOLIO_LIB_ERROR_NAMES } from './errorNames'
import { getNFTs, getTokens } from './getOnchainBalances'
import {
  getTokenDataCacheKey,
  getVisibleCollectibles,
  mergeCollectionHints,
  planAssetMetadata,
  tokenFilter
} from './helpers'
import {
  CollectionResult,
  GetOptions,
  Hints,
  Limits,
  LimitsOptions,
  PortfolioLibGetResult,
  TokenError,
  TokenMetadataFetchPlan,
  TokenResult
} from './interfaces'
import { flattenResults } from './pagination'

export const LIMITS: Limits = {
  // we have to be conservative with erc721Tokens because if we pass 30x20 (worst case) tokenIds, that's 30x20 extra words which is 19kb
  // proxy mode input is limited to 24kb
  deploylessProxyMode: {
    erc20: 66,
    erc20Simulation: 50,
    erc721: 30,
    erc721TokensInput: 20,
    erc721Tokens: 50
  },
  // theoretical capacity is 1666/450
  deploylessStateOverrideMode: {
    erc20: 230,
    erc20Simulation: 50,
    erc721: 70,
    erc721TokensInput: 70,
    erc721Tokens: 70
  }
}

// Re-exported for backwards compatibility.
export { PORTFOLIO_LIB_ERROR_NAMES }

export const getEmptyHints = (): Hints => ({
  erc20s: [],
  erc721s: {}
})

const defaultOptions: GetOptions = {
  baseCurrency: 'usd',
  blockTag: 'latest',
  tokenDataRecency: 0,
  fetchPinned: true,
  tokenDataRecencyOnFailure: 1 * 60 * 60 * 1000 // 1 hour
}

export class Portfolio {
  network: Network

  provider: RPCProvider

  /** Where token prices come from and are cached; shared between libs when passed in */
  private tokenPrices: TokenPricesService

  private deploylessTokens: Deployless

  private deploylessNfts: Deployless

  constructor(
    fetch: Fetch,
    provider: RPCProvider,
    network: Network,
    isTokenPricesEnabled: () => boolean = () => true,
    tokenPrices?: TokenPricesService
  ) {
    // One-off libs (e.g. asset info lookups) get their own, so they keep working without one
    this.tokenPrices = tokenPrices || new TokenPricesService({ fetch, isTokenPricesEnabled })
    this.provider = provider
    this.network = network
    this.deploylessTokens = fromDescriptor(provider, BalanceGetter, !network.rpcNoStateOverride)
    this.deploylessNfts = fromDescriptor(provider, NFTGetter, !network.rpcNoStateOverride)
  }

  async get(accountAddr: string, opts: Partial<GetOptions> = {}): Promise<PortfolioLibGetResult> {
    const errors: PortfolioLibGetResult['errors'] = []
    const {
      simulation,
      baseCurrency,
      fetchPinned,
      additionalErc20Hints,
      additionalErc721Hints,
      specialErc20Hints,
      specialErc721Hints,
      blockTag,
      tokenDataRecencyOnFailure,
      tokenDataRecency,
      isFullPortfolioUpdate,
      isStandaloneLookup,
      blacklist,
      preventTokenBlacklisting,
      deployless,
      knownTokenMetadata,
      knownCollectionMetadata
    } = { ...defaultOptions, ...opts }
    const toBeLearned: PortfolioLibGetResult['toBeLearned'] = {
      erc20s: [],
      erc721s: {}
    }
    if (simulation && simulation.baseAccount.getAccount().addr !== accountAddr)
      throw new Error('wrong account passed')

    const start = Date.now()

    const hints = getEmptyHints()

    hints.erc20s = [
      ...Object.values(specialErc20Hints || {}).flat(),
      ...(additionalErc20Hints || []),
      ...(fetchPinned ? PINNED_TOKENS.map((x) => x.address) : []),
      // add the fee tokens
      ...gasTankFeeTokens.filter((x) => x.chainId === this.network.chainId).map((x) => x.address)
    ]

    // Taken before the merge, which folds the custom ids in. The learned assets
    // are left out on purpose: adding a collectible also asks for it to be
    // learned, so they would report every custom collection as discovered.
    const discoveredCollections = new Set(
      Object.keys(additionalErc721Hints || {}).map((address) => address.toLowerCase())
    )

    hints.erc721s = mergeCollectionHints({
      additionalHints: additionalErc721Hints,
      apiHints: hints.erc721s,
      specialHints: specialErc721Hints
    })

    // Deduped before checksumming for performance
    const seenErc20Hints = new Set<string>()
    const checksummedErc20Hints: string[] = []

    hints.erc20s.forEach((address) => {
      try {
        const lowercasedAddress = address.toLowerCase()

        if (seenErc20Hints.has(lowercasedAddress)) return

        // getAddress may throw an error. This will break the portfolio
        // if the error isn't caught
        const checksummedAddress = getAddress(address)

        seenErc20Hints.add(lowercasedAddress)
        checksummedErc20Hints.push(checksummedAddress)
      } catch {
        // Not an address, so it can't be a token
      }
    })

    // Merge static and dynamic blacklisted addresses for this chain
    const chainIdStr = this.network.chainId.toString()
    const staticBlacklistedAddrs = STATIC_BLACKLIST.blacklistAddrs[chainIdStr] || []
    const dynamicBlacklistedAddrs = blacklist?.blacklistAddrs[chainIdStr] || []
    const allBlacklistedAddrs = new Set([...staticBlacklistedAddrs, ...dynamicBlacklistedAddrs])
    const filteredChecksummedHints = preventTokenBlacklisting
      ? checksummedErc20Hints
      : checksummedErc20Hints.filter((addr) => !allBlacklistedAddrs.has(addr))

    // Remove duplicates and always add ZeroAddress
    hints.erc20s = [...new Set(filteredChecksummedHints.concat(ZeroAddress))]

    const collectionsHints = Object.entries(hints.erc721s)

    // Decided once for the whole update so that every page agrees on which assets
    // must be read in full, and so the freshly read ones can be reported back. With
    // nothing held, everything is read from the chain and nothing is reported back.
    const metadataPlan = planAssetMetadata(hints.erc20s, knownTokenMetadata, start)
    const collectionMetadataPlan = planAssetMetadata(
      Object.keys(hints.erc721s),
      knownCollectionMetadata,
      start
    )

    const discoveryDone = Date.now()

    // .isLimitedAt24kbData should be the same for both instances; @TODO more elegant check?
    const limits: LimitsOptions = this.deploylessTokens.isLimitedAt24kbData
      ? LIMITS.deploylessProxyMode
      : LIMITS.deploylessStateOverrideMode
    const [tokensWithErr, collectionsWithErr] = await Promise.all([
      flattenResults(
        paginate(hints.erc20s, opts.simulation ? limits.erc20Simulation : limits.erc20).map(
          (page) =>
            getTokens(
              this.network,
              this.deploylessTokens,
              { simulation, blockTag, specialErc20Hints, deployless, metadataPlan },
              accountAddr,
              page
            )
        )
      ),
      flattenResults(
        paginate(collectionsHints, limits.erc721).map((page) =>
          getNFTs(
            this.network,
            this.deploylessNfts,
            { simulation, blockTag, deployless, metadataPlan: collectionMetadataPlan },
            accountAddr,
            page,
            limits
          )
        )
      )
    ])

    const [tokensWithErrResult, metaData] = tokensWithErr
    const { blockNumber, beforeNonce, afterNonce } = metaData as {
      blockNumber: number
      beforeNonce: bigint
      afterNonce: bigint
    }
    const [collectionsWithErrResult] = collectionsWithErr
    const fetchedTokenMetadata: PortfolioLibGetResult['fetchedTokenMetadata'] = []
    const fetchedCollectionMetadata: PortfolioLibGetResult['fetchedCollectionMetadata'] = []

    // Re-map/filter into our format
    const nativeToken = tokensWithErrResult.find(
      ([, result]) => result.address === ZeroAddress
    )?.[1]

    const isValidToken = (error: TokenError, token: TokenResult): boolean =>
      error === '0x' && !!token.symbol

    // name() and symbol() belong to the optional ERC721Metadata extension, so a
    // collection without them is still a collection - the ENS registrar is one.
    // Only the getter erroring says an address holds no collection, and it does
    // error for one that doesn't.
    const isValidCollection = (error: TokenError): boolean => error === '0x'

    const blacklistPatterns = prepareBlacklistPatterns([
      ...STATIC_BLACKLIST.blacklistBySymbols,
      ...(blacklist?.blacklistBySymbols || [])
    ])

    const tokensWithoutPrices = tokensWithErrResult
      .filter((_tokensWithErrResult: [TokenError, TokenResult]) => {
        if (!isValidToken(_tokensWithErrResult[0], _tokensWithErrResult[1])) return false

        const token = _tokensWithErrResult[1]

        // Kept before any of the filtering below, so metadata read for a token the
        // user never sees is not read again on the next update.
        if (knownTokenMetadata && metadataPlan.needsMetadata.has(token.address)) {
          fetchedTokenMetadata.push([
            token.address,
            {
              symbol: token.symbol,
              name: token.name,
              decimals: token.decimals,
              fetchedAt: start
            }
          ])
        }

        // Spam filter: hide tokens whose symbol/name matches a blacklisted
        // pattern. Custom (user-added) tokens are never hidden. We don't run the
        // embedded-domain check here because token names/symbols legitimately contain domains.
        if (
          isBlacklistedAsset({
            symbol: token.symbol,
            name: token.name,
            isCustom: token.flags?.isCustom,
            patterns: blacklistPatterns
          })
        ) {
          portfolioDebugLog(
            'blacklist',
            `${this.network.chainId.toString()}: Filtered token ${token.symbol}`,
            {
              address: token.address,
              symbol: token.symbol,
              name: token.name
            }
          )
          return false
        }

        // Don't filter by balance/custom/hidden etc. if this param isn't passed
        // The portfolio lib is used outside the controller, in which case we want to
        // fetch all tokens regardless of their balance or type
        if (!specialErc20Hints) return true

        // To be learned tokens are never filtered out to ensure that
        // the humanizer, simulation and etc. work even if the account doesn't have amount
        // on either block (latest/pending)
        const isToBeLearned = specialErc20Hints.learn.includes(_tokensWithErrResult[1].address)

        return tokenFilter(
          _tokensWithErrResult[1],
          this.network,
          isToBeLearned,
          !!fetchPinned,
          nativeToken
        )
      })
      .map(([, result]) => {
        if (
          result.amount &&
          !result.flags.isCustom &&
          !result.flags.isHidden &&
          !toBeLearned.erc20s.includes(result.address)
        ) {
          // Add all non-zero tokens to toBeLearned
          toBeLearned.erc20s.push(result.address)
        }

        return result
      })

    // Unlike the deployless ones, preference addresses aren't always checksummed.
    // An empty array of ids means the collection was added before they were
    // recorded, otherwise the listed collectibles are the added ones
    const customCollectibles: { [lowercasedAddress: string]: bigint[] } = {}
    Object.entries(specialErc721Hints?.custom || {}).forEach(([address, ids]) => {
      customCollectibles[address.toLowerCase()] = ids
    })
    // An empty array of ids hides the whole collection, otherwise the listed
    // collectibles are the hidden ones
    const hiddenCollectibles: { [lowercasedAddress: string]: bigint[] } = {}
    Object.entries(specialErc721Hints?.hidden || {}).forEach(([address, ids]) => {
      hiddenCollectibles[address.toLowerCase()] = ids
    })

    const collections = collectionsWithErrResult.reduce<CollectionResult[]>(
      (acc, [error, collection]) => {
        // The same check the collection errors are built from, so a collection is
        // either displayed or reported, never both
        if (!isValidCollection(error)) return acc

        const lowercasedAddress = collection.address.toLowerCase()
        const customIds = customCollectibles[lowercasedAddress]
        const isCustom = !!customIds
        const hiddenIds = hiddenCollectibles[lowercasedAddress]
        const isHidden = !!hiddenIds && !hiddenIds.length
        const visibleCollectibles = getVisibleCollectibles({
          collectibles: collection.collectibles,
          customIds,
          hiddenIds,
          isDiscovered: discoveredCollections.has(lowercasedAddress)
        })

        // Kept before the filtering below, for the same reason as the token metadata
        if (
          knownCollectionMetadata &&
          collectionMetadataPlan.needsMetadata.has(collection.address)
        ) {
          fetchedCollectionMetadata.push([
            collection.address,
            {
              symbol: collection.symbol,
              name: collection.name,
              fetchedAt: start
            }
          ])
        }

        // Spam filter: hide collections whose symbol/name matches a blacklisted
        // pattern or embeds a phishing domain. Custom (user-added) collections
        // are never hidden.
        if (
          isBlacklistedAsset({
            symbol: collection.symbol,
            name: collection.name,
            isCustom,
            patterns: blacklistPatterns,
            checkForEmbeddedDomain: true
          })
        ) {
          portfolioDebugLog(
            'blacklist',
            `${this.network.chainId.toString()}: Filtered collection ${collection.name}`,
            {
              address: collection.address,
              symbol: collection.symbol,
              name: collection.name
            }
          )

          return acc
        }

        // Important note: Collections with 0 collectibles are allowed to pass through the filter.
        // A hidden collection is requested by its own hint, so it doesn't have to
        // be learned. A custom one is learned like any other, and removing it
        // forgets that too, see `#forgetCollectible` in the hints controller.
        if (
          !isHidden &&
          !toBeLearned.erc721s[collection.address] &&
          collection.collectibles.length > 0
        ) {
          toBeLearned.erc721s[collection.address] = collection.collectibles
        }

        acc.push({
          ...collection,
          collectibles: visibleCollectibles,
          // Collections have no flags until this point
          flags: { isCustom, isHidden },
          // Collection prices are never requested, they only come with Velcro's discovery response
          priceIn:
            this.tokenPrices.getCachedTokenData(
              this.network.chainId,
              collection.address,
              tokenDataRecency,
              baseCurrency
            )?.priceIn || []
        })
        return acc
      },
      []
    )

    const oracleCallDone = Date.now()

    const tokenAddressesToPrice = tokensWithoutPrices.map((token) => token.address)
    // Every token's price comes from a single call, which either answers from the cache or
    // requests the account's whole token list again (or, for a standalone lookup, only the
    // tokens missing from the cache)
    const { tokenData, error: priceError } = isStandaloneLookup
      ? await this.tokenPrices.getStandaloneTokenData({
          network: this.network,
          tokenAddresses: tokenAddressesToPrice,
          maxAgeMs: tokenDataRecency,
          baseCurrency
        })
      : await this.tokenPrices.getTokenData({
          network: this.network,
          accountAddr,
          source: isFullPortfolioUpdate ? 'portfolio' : undefined,
          tokenAddresses: tokenAddressesToPrice,
          maxAgeMs: tokenDataRecency,
          maxAgeOnFailureMs: tokenDataRecencyOnFailure,
          baseCurrency
        })

    const tokensWithPrices: TokenResult[] = tokensWithoutPrices.map(
      (token: Omit<TokenResult, 'priceIn' | 'marketDataIn' | 'meta'>) => ({
        ...token,
        priceIn: [],
        marketDataIn: [],
        ...tokenData.get(getTokenDataCacheKey(token.address))
      })
    )

    // Don't display an error if every token still has a (cached) price
    if (priceError && tokensWithPrices.some((token) => !token.priceIn.length)) {
      errors.push({
        name: PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError,
        message: priceError.message,
        level: 'warning'
      })
    }

    const priceUpdateDone = Date.now()

    return {
      toBeLearned,
      fetchedTokenMetadata,
      fetchedCollectionMetadata,
      errors,
      updateStarted: start,
      discoveryTime: discoveryDone - start,
      oracleCallTime: oracleCallDone - discoveryDone,
      priceUpdateTime: priceUpdateDone - oracleCallDone,
      tokens: tokensWithPrices,
      feeTokens: tokensWithPrices.filter((t) => {
        // return the native token
        if (t.address === ZeroAddress && t.chainId === this.network.chainId) return true

        return getFeeToken(t.address, t.chainId)
      }),
      beforeNonce,
      afterNonce,
      blockNumber,
      tokenErrors: tokensWithErrResult
        .filter(([error, result]: [string, TokenResult]) => !isValidToken(error, result))
        .map(([error, result]: [string, TokenResult]) => ({ error, address: result.address })),
      collectionErrors: collectionsWithErrResult
        .filter(([error]: [string, CollectionResult]) => !isValidCollection(error))
        .map(([error, result]: [string, CollectionResult]) => ({ error, address: result.address })),
      collections
    }
  }

  async getTokensByAddresses(
    accountAddr: string,
    tokenAddrs: string[],
    opts: Pick<GetOptions, 'blockTag' | 'simulation' | 'specialErc20Hints' | 'deployless'>
  ): Promise<[TokenError, TokenResult][]> {
    const uniqueTokenAddrs = [...new Set(tokenAddrs)]

    if (!uniqueTokenAddrs.length) return []

    const limits: LimitsOptions = this.deploylessTokens.isLimitedAt24kbData
      ? LIMITS.deploylessProxyMode
      : LIMITS.deploylessStateOverrideMode

    // Nothing is remembered across these one-off reads, so every token is read in full
    const metadataPlan: TokenMetadataFetchPlan = {
      known: new Map(),
      needsMetadata: new Set(uniqueTokenAddrs)
    }

    const [tokensWithErrResult] = await flattenResults(
      paginate(uniqueTokenAddrs, limits.erc20).map((page) =>
        getTokens(this.network, this.deploylessTokens, { ...opts, metadataPlan }, accountAddr, page)
      )
    )

    return tokensWithErrResult.map(([error, token]) => [
      error,
      {
        ...token,
        priceIn: token.priceIn || [],
        marketDataIn: token.marketDataIn || []
      }
    ])
  }
}
