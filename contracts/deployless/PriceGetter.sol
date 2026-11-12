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

interface ITokenDecimals {
  function decimals() external view returns (uint8);
}

/**
 * Reads token prices from the chain alone: the native token's USD price from its Chainlink
 * feed, and each token's rate to the native token from 1inch's spot price aggregator, along with
 * how much of the native token its most liquid pool holds. Meant to be called off-chain, without
 * being deployed.
 */
contract PriceGetter {
  // The aggregator walks every pool it knows of for a token, which can take over 10M gas.
  // The limit keeps a single token from using up the gas of the whole call.
  uint256 private constant TOKEN_GAS_LIMIT = 15_000_000;
  // Left for finishing the loop and returning the results once the tokens stop being checked
  uint256 private constant GAS_RESERVE = 500_000;

  struct NativePrice {
    int256 answer;
    uint8 decimals;
    uint256 updatedAt;
  }

  struct TokenRate {
    /// The rate to the native token, scaled by 1e18 and by the difference in decimals. 0 when
    /// the token has no price.
    uint256 rateToNative;
    uint8 decimals;
    /// How much of the native token (in wei) the token's most liquid pool holds
    uint256 poolDepth;
    /// Whether the token is the native token or wraps it, which leaves `poolDepth` unknown
    bool isNative;
  }

  function getTokenRate(
    ISpotPriceOracle oracle,
    address token,
    uint256 thresholdFilter
  ) external view returns (TokenRate memory rate) {
    rate.decimals = ITokenDecimals(token).decimals();

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

      // A pool's weight is the geometric mean of its two reserves, and its rate their ratio,
      // so the weight times the square root of the rate is its native token reserve
      uint256 poolDepth = (price.weight * sqrt(price.rate * 1e18)) / 1e18;
      if (poolDepth > rate.poolDepth) rate.poolDepth = poolDepth;
    }

    if (totalWeight > 0) rate.rateToNative = weightedRateSum / totalWeight;
  }

  /**
   * @param thresholdFilter leaves out the pools whose liquidity is below this percentage of the
   * token's most liquid pool
   * @return nativePrice the native token's USD price, as the feed reports it
   * @return rates the rate and pool depth of each token, in the order of `tokens`
   * @return checkedCount how many tokens, from the start of `tokens`, were checked before the
   * gas the call was given ran low. The rest were not checked and should be asked for again.
   */
  function getPrices(
    IPriceFeed nativeUsdFeed,
    ISpotPriceOracle oracle,
    address[] calldata tokens,
    uint256 thresholdFilter
  )
    external
    view
    returns (NativePrice memory nativePrice, TokenRate[] memory rates, uint256 checkedCount)
  {
    (, nativePrice.answer, , nativePrice.updatedAt, ) = nativeUsdFeed.latestRoundData();
    nativePrice.decimals = nativeUsdFeed.decimals();

    rates = new TokenRate[](tokens.length);
    for (; checkedCount < tokens.length; checkedCount++) {
      // Stopping here, rather than giving the token less gas, keeps it from failing for lack of
      // gas and being reported as having no price
      if (gasleft() < TOKEN_GAS_LIMIT + GAS_RESERVE) break;

      try
        this.getTokenRate{ gas: TOKEN_GAS_LIMIT }(oracle, tokens[checkedCount], thresholdFilter)
      returns (TokenRate memory rate) {
        rates[checkedCount] = rate;
      } catch {
        // The token has no pools, isn't a token, or its pools can't be read: its rate stays 0,
        // which reports it as having no price
      }
    }
  }

  /// The integer square root, rounded down (Babylonian method)
  function sqrt(uint256 x) internal pure returns (uint256 y) {
    if (x == 0) return 0;
    uint256 z = x / 2 + 1;
    y = x;
    while (z < y) {
      y = z;
      z = (x / z + z) / 2;
    }
  }
}
