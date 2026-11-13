// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

/// 1inch's spot price aggregator: a liquidity-weighted average of the token's DEX pools
interface ISpotPriceOracle {
  /// One pool (or route through a connector token) and its liquidity weight
  struct OraclePrice {
    uint256 rate;
    uint256 weight;
  }

  struct OraclePrices {
    uint256 maxOracleWeight;
    uint256 size;
    OraclePrice[] oraclePrices;
  }

  /**
   * @return wrappedPrice set, with no pools, when the token is the native token or wraps it
   * @return ratesAndWeights the rate and liquidity weight of each of the token's pools
   */
  function getRatesAndWeightsToEthWithCustomConnectors(
    address srcToken,
    bool useSrcWrappers,
    address[] calldata customConnectors,
    uint256 thresholdFilter
  ) external view returns (uint256 wrappedPrice, OraclePrices memory ratesAndWeights);
}

/// A Chainlink price feed
interface IPriceFeed {
  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );

  function decimals() external view returns (uint8);
}

interface IERC20Like {
  function decimals() external view returns (uint8);

  function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV2Factory {
  function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IUniswapV3Factory {
  function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

/// Velodrome v2, Aerodrome and their forks
interface ISolidlyFactory {
  function getPool(address tokenA, address tokenB, bool stable) external view returns (address);
}

/// Velodrome's and Aerodrome's concentrated liquidity (Slipstream)
interface ISlipstreamFactory {
  function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address);
}

/**
 * Reads token prices from the chain alone: the native token's USD price from its Chainlink
 * feed, and each token's rate to the native token from 1inch's spot price aggregator, along with
 * how much of the wrapped native token and of the main stablecoins its pools on the network's
 * main DEXes hold. Meant to be called off-chain, without being deployed.
 */
contract PriceGetter {
  // The aggregator walks every pool it knows of for a token, which can take over 10M gas.
  // The limit keeps a single token from using up the gas of the whole call.
  uint256 private constant TOKEN_GAS_LIMIT = 15_000_000;
  // With less gas than this left, no further token is tried
  uint256 private constant MIN_TOKEN_GAS = 1_000_000;
  // Left for finishing the loop and returning the results once the tokens stop being checked
  uint256 private constant GAS_RESERVE = 500_000;

  struct NativePrice {
    int256 answer;
    uint8 decimals;
    uint256 updatedAt;
  }

  /// How the factory looks up the pool of two tokens
  enum FactoryKind {
    /// `getPair(tokenA, tokenB)`
    UniswapV2,
    /// `getPool(tokenA, tokenB, fee)`, for each fee in `params`
    UniswapV3,
    /// `getPool(tokenA, tokenB, stable)`, for both a stable and a volatile pool
    Solidly,
    /// `getPool(tokenA, tokenB, tickSpacing)`, for each tick spacing in `params`
    Slipstream
  }

  struct PoolFactory {
    address factory;
    FactoryKind kind;
    /// The fees (UniswapV3) or tick spacings (Slipstream) to look up pools for
    uint256[] params;
  }

  /// Where to look for a token's pools, to tell how much liquidity it really has
  struct PoolSearch {
    address wrappedNative;
    /// USD stablecoins, each counted as worth $1
    address[] stablecoins;
    PoolFactory[] factories;
  }

  struct TokenRate {
    /// The rate to the native token, scaled by 1e18 and by the difference in decimals. 0 when
    /// the token has no price.
    uint256 rateToNative;
    uint8 decimals;
    /// How much of the wrapped native token (in wei) the token's deepest pool against it holds
    uint256 nativeReserve;
    /// How many stablecoins (scaled to 18 decimals) the token's deepest pool against one holds
    uint256 stableReserve;
    /// Whether the token is the native token or wraps it, which leaves the reserves unknown
    bool isNative;
  }

  function getTokenRate(
    ISpotPriceOracle oracle,
    address token,
    uint256 thresholdFilter,
    PoolSearch calldata search
  ) external view returns (TokenRate memory rate) {
    rate.decimals = IERC20Like(token).decimals();

    (uint256 wrappedPrice, ISpotPriceOracle.OraclePrices memory prices) = oracle
      .getRatesAndWeightsToEthWithCustomConnectors(token, false, new address[](0), thresholdFilter);

    if (wrappedPrice > 0) {
      rate.rateToNative = wrappedPrice;
      rate.isNative = true;
      return rate;
    }

    // The same weighted average the aggregator's own `getRateToEth` returns: the pools whose
    // weight is below `thresholdFilter` percent of the largest weight are left out
    uint256 weightedRateSum;
    uint256 totalWeight;
    uint256 size = prices.size < prices.oraclePrices.length
      ? prices.size
      : prices.oraclePrices.length;

    for (uint256 i = 0; i < size; i++) {
      ISpotPriceOracle.OraclePrice memory price = prices.oraclePrices[i];
      if (price.weight == 0 || price.weight * 100 < prices.maxOracleWeight * thresholdFilter)
        continue;
      // Skipped rather than reverting, as the aggregator does
      if (price.rate > type(uint256).max / price.weight) continue;

      weightedRateSum += price.rate * price.weight;
      totalWeight += price.weight;
    }

    if (totalWeight == 0) return rate;
    rate.rateToNative = weightedRateSum / totalWeight;

    // The aggregator's weights can't tell how much a pool really holds: in a concentrated
    // liquidity pool (e.g. Uniswap v3) a narrow position worth a few dollars weighs as much as a
    // deep pool, and a route through another token is weighed by both of its pools. So the
    // liquidity is read from what the token's pools actually hold of the tokens it's paired with.
    rate.nativeReserve = getDeepestReserve(search.factories, token, search.wrappedNative);
    for (uint256 i = 0; i < search.stablecoins.length; i++) {
      address stablecoin = search.stablecoins[i];
      if (stablecoin == token) continue;

      uint256 stableReserve = toEighteenDecimals(
        getDeepestReserve(search.factories, token, stablecoin),
        IERC20Like(stablecoin).decimals()
      );
      if (stableReserve > rate.stableReserve) rate.stableReserve = stableReserve;
    }
  }

  /// How much of `pairedToken` the deepest pool of `token` against it holds, across the factories
  function getDeepestReserve(
    PoolFactory[] calldata factories,
    address token,
    address pairedToken
  ) internal view returns (uint256 deepest) {
    for (uint256 i = 0; i < factories.length; i++) {
      uint256 reserve = getFactoryDeepestReserve(factories[i], token, pairedToken);
      if (reserve > deepest) deepest = reserve;
    }
  }

  function getFactoryDeepestReserve(
    PoolFactory calldata poolFactory,
    address token,
    address pairedToken
  ) internal view returns (uint256 deepest) {
    if (poolFactory.kind == FactoryKind.UniswapV2) {
      try IUniswapV2Factory(poolFactory.factory).getPair(token, pairedToken) returns (address pool) {
        return getReserve(pool, pairedToken);
      } catch {
        return 0;
      }
    }

    if (poolFactory.kind == FactoryKind.Solidly) {
      for (uint256 i = 0; i < 2; i++) {
        try ISolidlyFactory(poolFactory.factory).getPool(token, pairedToken, i == 1) returns (
          address pool
        ) {
          uint256 reserve = getReserve(pool, pairedToken);
          if (reserve > deepest) deepest = reserve;
        } catch {}
      }
      return deepest;
    }

    for (uint256 i = 0; i < poolFactory.params.length; i++) {
      address pool = getConcentratedPool(poolFactory, token, pairedToken, poolFactory.params[i]);
      uint256 reserve = getReserve(pool, pairedToken);
      if (reserve > deepest) deepest = reserve;
    }
  }

  /// The UniswapV3 or Slipstream pool for the fee or tick spacing, or no address
  function getConcentratedPool(
    PoolFactory calldata poolFactory,
    address token,
    address pairedToken,
    uint256 param
  ) internal view returns (address) {
    if (poolFactory.kind == FactoryKind.UniswapV3) {
      try IUniswapV3Factory(poolFactory.factory).getPool(token, pairedToken, uint24(param)) returns (
        address pool
      ) {
        return pool;
      } catch {
        return address(0);
      }
    }

    try
      ISlipstreamFactory(poolFactory.factory).getPool(token, pairedToken, int24(int256(param)))
    returns (address pool) {
      return pool;
    } catch {
      return address(0);
    }
  }

  /// How much of `pairedToken` the pool holds: what it really has, not what its liquidity
  /// suggests
  function getReserve(address pool, address pairedToken) internal view returns (uint256) {
    if (pool == address(0)) return 0;

    try IERC20Like(pairedToken).balanceOf(pool) returns (uint256 balance) {
      return balance;
    } catch {
      return 0;
    }
  }

  function toEighteenDecimals(uint256 amount, uint8 decimals) internal pure returns (uint256) {
    if (decimals <= 18) return amount * 10 ** (18 - decimals);
    return amount / 10 ** (decimals - 18);
  }

  /**
   * @param thresholdFilter leaves out the pools whose liquidity is below this percentage of the
   * token's most liquid pool
   * @param search where to look for each token's pools, to read how much liquidity it has
   * @return nativePrice the native token's USD price, as the feed reports it
   * @return rates the rate and pool reserves of each token, in the order of `tokens`
   * @return checkedCount how many tokens, from the start of `tokens`, were checked before the
   * gas the call was given ran low. The rest were not checked and should be asked for again. On
   * an RPC that gives a call less gas than TOKEN_GAS_LIMIT, it can be 0 for a token that needs
   * more than the RPC allows.
   */
  function getPrices(
    IPriceFeed nativeUsdFeed,
    ISpotPriceOracle oracle,
    address[] calldata tokens,
    uint256 thresholdFilter,
    PoolSearch calldata search
  )
    external
    view
    returns (NativePrice memory nativePrice, TokenRate[] memory rates, uint256 checkedCount)
  {
    (, nativePrice.answer, , nativePrice.updatedAt, ) = nativeUsdFeed.latestRoundData();
    nativePrice.decimals = nativeUsdFeed.decimals();

    rates = new TokenRate[](tokens.length);
    for (; checkedCount < tokens.length; checkedCount++) {
      uint256 available = gasleft();
      if (available < MIN_TOKEN_GAS + GAS_RESERVE) break;

      // Up to TOKEN_GAS_LIMIT, or what's left when that's less (e.g. an RPC that gives a call
      // less gas), keeping in mind that a call is given at most 63/64 of the remaining gas
      uint256 tokenGas = available - GAS_RESERVE - available / 64;
      if (tokenGas > TOKEN_GAS_LIMIT) tokenGas = TOKEN_GAS_LIMIT;

      uint256 gasBeforeCall = gasleft();
      try
        this.getTokenRate{ gas: tokenGas }(oracle, tokens[checkedCount], thresholdFilter, search)
      returns (TokenRate memory rate) {
        rates[checkedCount] = rate;
      } catch {
        // It used up all the gas it was given, so it ran out of gas rather than having no
        // price. With less than the full allowance, it's left unchecked, to be asked for again
        // in a call with more gas, instead of being reported as having no price.
        if (tokenGas < TOKEN_GAS_LIMIT && gasBeforeCall - gasleft() >= tokenGas) break;

        // Otherwise the token has no pools, isn't a token, its pools can't be read, or it needs
        // more than TOKEN_GAS_LIMIT: its rate stays 0, which reports it as having no price
      }
    }
  }
}
