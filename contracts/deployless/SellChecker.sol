// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

interface ISellCheckerToken {
  function balanceOf(address account) external view returns (uint256);
}

interface ISellCheckerV2Factory {
  function getPair(address tokenA, address tokenB) external view returns (address);
}

interface ISellCheckerV3Factory {
  function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

/// Velodrome v2, Aerodrome and their forks
interface ISellCheckerSolidlyFactory {
  function getPool(address tokenA, address tokenB, bool stable) external view returns (address);
}

/// Velodrome's and Aerodrome's concentrated liquidity (Slipstream)
interface ISellCheckerSlipstreamFactory {
  function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address);
}

/// A Uniswap v2 pair, or a Solidly pool, which swaps the same way
interface ISellCheckerPair {
  function token0() external view returns (address);

  function getReserves() external view returns (uint256 reserve0, uint256 reserve1, uint256 time);

  function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface ISellCheckerSolidlyPool {
  function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256);
}

/// A Uniswap v3 pool, or one of its forks (PancakeSwap v3, Slipstream)
interface ISellCheckerConcentratedPool {
  function token0() external view returns (address);

  function swap(
    address recipient,
    bool zeroForOne,
    int256 amountSpecified,
    uint160 sqrtPriceLimitX96,
    bytes calldata data
  ) external returns (int256 amount0, int256 amount1);
}

/**
 * Tells whether tokens an account holds can be sold, and how much of their value the token keeps
 * when they are: each token is sold into its deepest pools on the network's main DEXes, taken from
 * the account with `transferFrom`, the way a DEX router takes it. Meant to be run in a simulation
 * only, after the account approves it, never deployed: a sale really happens in the simulation.
 *
 * It catches tokens that block selling (e.g. by reverting their transfers into the pool), and the
 * ones that keep part of what is sold, by measuring what arrives in the pool. It can't catch a
 * token that blocks only some sellers chosen later, or whose selling fee is raised later.
 */
contract SellChecker {
  // Each sale gets at most this much gas, so one token can't use up the gas of the others
  uint256 private constant SALE_GAS_LIMIT = 3_000_000;
  // With less gas than this left, no further sale is tried
  uint256 private constant MIN_SALE_GAS = 500_000;
  // Left for finishing the loop and returning the results
  uint256 private constant GAS_RESERVE = 200_000;
  // The lowest and highest prices a Uniswap v3 swap can move to, plus and minus one
  uint160 private constant MIN_SQRT_PRICE_LIMIT = 4295128740;
  uint160 private constant MAX_SQRT_PRICE_LIMIT =
    1461446703485210103287273052203988822378723970341;
  // A Uniswap v2 pair's fee is 0.3%, and the forks' fees are mostly lower. The sale asks for what
  // a 1% fee leaves, so that a fork with a higher fee doesn't reject it.
  uint256 private constant V2_AMOUNT_IN_AFTER_FEE = 990;
  uint256 private constant BPS = 10_000;

  /// How the factory looks up the pool of two tokens. The same values as `PriceGetter`'s
  enum FactoryKind {
    /// `getPair(tokenA, tokenB)`
    UniswapV2,
    /// `getPool(tokenA, tokenB, fee)`, for each fee in `params`
    UniswapV3,
    /// `getPool(tokenA, tokenB, stable)`, for both a stable and a volatile pool
    Solidly,
    /// `getPool(tokenA, tokenB, tickSpacing)`, for each tick spacing in `params`
    Slipstream,
    /// Curve's factories. Their pools aren't sold into.
    Curve
  }

  struct PoolFactory {
    address factory;
    FactoryKind kind;
    /// The fees (UniswapV3) or tick spacings (Slipstream) to look up pools for
    uint256[] params;
  }

  /// Where to look for a token's pools. The same as `PriceGetter`'s
  struct PoolSearch {
    address wrappedNative;
    /// USD stablecoins
    address[] stablecoins;
    PoolFactory[] factories;
  }

  enum PoolKind {
    /// Uniswap v2 and its forks
    Pair,
    /// Velodrome v2, Aerodrome and their forks
    Solidly,
    /// Uniswap v3 and its forks
    Concentrated
  }

  struct Pool {
    address pool;
    PoolKind kind;
    /// The token the pool pays out for the sold one
    address pairedToken;
    /// How much of `pairedToken` the pool holds
    uint256 reserve;
  }

  enum SaleStatus {
    /// The token has no pool to be sold into, or no sale could tell (e.g. too little to sell)
    Unknown,
    /// A sale went through
    Sold,
    /// Every sale that was tried failed
    Failed
  }

  struct SaleCheck {
    SaleStatus status;
    /// The share of the sold tokens, in basis points, that didn't reach the pool. Set only when
    /// the token was sold. 10000 when none of them did.
    uint256 sellFeeBps;
  }

  /// A sale that tells nothing about the token, e.g. one too small to get anything back
  error InconclusiveSale();
  error TransferFailed();
  error NotCalledBySelf();
  error UnexpectedCallback();

  // The sale into a concentrated liquidity pool in progress, which the pool's callback pays for
  address private activePool;
  address private activeOwner;
  address private activeToken;

  /**
   * @param owner the account whose tokens are sold. It must have approved this contract.
   * @param tokens the tokens to sell
   * @param amounts how much of each token to sell, in the order of `tokens`
   * @param search where to look for each token's pools
   * @return checks what selling each token did, in the order of `tokens`
   */
  function checkSales(
    address owner,
    address[] calldata tokens,
    uint256[] calldata amounts,
    PoolSearch calldata search
  ) external returns (SaleCheck[] memory checks) {
    checks = new SaleCheck[](tokens.length);

    for (uint256 i = 0; i < tokens.length; i++) {
      Pool[] memory pools = findPools(tokens[i], search);
      checks[i] = checkSale(owner, tokens[i], amounts[i], pools);
    }
  }

  /// Sells the token into its pools, deepest first, until a sale goes through
  function checkSale(
    address owner,
    address token,
    uint256 amount,
    Pool[] memory pools
  ) internal returns (SaleCheck memory check) {
    bool hasFailedSale;

    for (uint256 i = 0; i < pools.length; i++) {
      if (pools[i].pool == address(0)) continue;

      uint256 available = gasleft();
      if (available < MIN_SALE_GAS + GAS_RESERVE) break;

      uint256 saleGas = available - GAS_RESERVE - available / 64;
      if (saleGas > SALE_GAS_LIMIT) saleGas = SALE_GAS_LIMIT;

      uint256 gasBeforeSale = gasleft();
      try this.sell{ gas: saleGas }(owner, token, amount, pools[i]) returns (uint256 sellFeeBps) {
        check.status = SaleStatus.Sold;
        check.sellFeeBps = sellFeeBps;
        return check;
      } catch (bytes memory reason) {
        // A sale that ran out of gas or that tells nothing doesn't count as a failed one
        bool ranOutOfGas = gasBeforeSale - gasleft() >= saleGas;
        if (ranOutOfGas || isInconclusiveSale(reason)) continue;

        hasFailedSale = true;
      }
    }

    if (hasFailedSale) check.status = SaleStatus.Failed;
  }

  function isInconclusiveSale(bytes memory reason) internal pure returns (bool) {
    return reason.length == 4 && bytes4(reason) == InconclusiveSale.selector;
  }

  /**
   * Sells the owner's tokens into the pool. Called only by this contract, so that a failed sale is
   * undone.
   * @return sellFeeBps the share of the tokens, in basis points, that didn't reach the pool
   */
  function sell(
    address owner,
    address token,
    uint256 amount,
    Pool memory pool
  ) external returns (uint256 sellFeeBps) {
    if (msg.sender != address(this)) revert NotCalledBySelf();
    if (pool.kind == PoolKind.Concentrated) return sellToConcentratedPool(owner, token, amount, pool);

    return sellToPair(owner, token, amount, pool);
  }

  function sellToPair(
    address owner,
    address token,
    uint256 amount,
    Pool memory pool
  ) internal returns (uint256 sellFeeBps) {
    uint256 poolBalanceBefore = ISellCheckerToken(token).balanceOf(pool.pool);
    transferFrom(token, owner, pool.pool, amount);
    uint256 arrived = ISellCheckerToken(token).balanceOf(pool.pool) - poolBalanceBefore;
    // The token kept everything that was sold
    if (arrived == 0) return BPS;

    sellFeeBps = arrived >= amount ? 0 : ((amount - arrived) * BPS) / amount;

    bool isToken0 = ISellCheckerPair(pool.pool).token0() == token;
    (uint256 reserve0, uint256 reserve1, ) = ISellCheckerPair(pool.pool).getReserves();
    (uint256 reserveIn, uint256 reserveOut) = isToken0 ? (reserve0, reserve1) : (reserve1, reserve0);
    // What the pair sees as sold: all it holds of the token above its reserve
    uint256 amountIn = ISellCheckerToken(token).balanceOf(pool.pool) - reserveIn;
    uint256 amountOut = getPairAmountOut(pool, token, amountIn, reserveIn, reserveOut);
    if (amountOut == 0) revert InconclusiveSale();

    uint256 pairedBalanceBefore = ISellCheckerToken(pool.pairedToken).balanceOf(address(this));
    (uint256 amount0Out, uint256 amount1Out) = isToken0 ? (uint256(0), amountOut) : (amountOut, 0);
    ISellCheckerPair(pool.pool).swap(amount0Out, amount1Out, address(this), '');
    if (ISellCheckerToken(pool.pairedToken).balanceOf(address(this)) <= pairedBalanceBefore)
      revert InconclusiveSale();
  }

  function getPairAmountOut(
    Pool memory pool,
    address token,
    uint256 amountIn,
    uint256 reserveIn,
    uint256 reserveOut
  ) internal view returns (uint256) {
    // A Solidly pool's own quote, less 0.1%, so that rounding doesn't get the sale rejected
    if (pool.kind == PoolKind.Solidly)
      return (ISellCheckerSolidlyPool(pool.pool).getAmountOut(amountIn, token) * 999) / 1000;

    uint256 amountInAfterFee = amountIn * V2_AMOUNT_IN_AFTER_FEE;
    return (amountInAfterFee * reserveOut) / (reserveIn * 1000 + amountInAfterFee);
  }

  function sellToConcentratedPool(
    address owner,
    address token,
    uint256 amount,
    Pool memory pool
  ) internal returns (uint256) {
    // 0.1% is held back to pay with, as tokens that move a wei or two less than asked (e.g. stETH)
    // would otherwise get the payment rejected
    uint256 amountToSell = amount - amount / 1000;
    if (amountToSell == 0) revert InconclusiveSale();

    bool zeroForOne = ISellCheckerConcentratedPool(pool.pool).token0() == token;
    uint256 pairedBalanceBefore = ISellCheckerToken(pool.pairedToken).balanceOf(address(this));
    activePool = pool.pool;
    activeOwner = owner;
    activeToken = token;
    ISellCheckerConcentratedPool(pool.pool).swap(
      address(this),
      zeroForOne,
      int256(amountToSell),
      zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT,
      ''
    );
    activePool = address(0);

    if (ISellCheckerToken(pool.pairedToken).balanceOf(address(this)) <= pairedBalanceBefore)
      revert InconclusiveSale();

    // The pool takes only the exact amount it asks for, so a token that keeps part of it can't
    // get here
    return 0;
  }

  function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
    payForSwap(amount0Delta, amount1Delta);
  }

  function pancakeV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
    payForSwap(amount0Delta, amount1Delta);
  }

  function payForSwap(int256 amount0Delta, int256 amount1Delta) internal {
    if (msg.sender != activePool || activePool == address(0)) revert UnexpectedCallback();

    uint256 owed = uint256(amount0Delta > 0 ? amount0Delta : amount1Delta);
    uint256 slack = owed / 1000 + 2;
    uint256 ownerBalance = ISellCheckerToken(activeToken).balanceOf(activeOwner);
    if (owed + slack > ownerBalance) slack = ownerBalance > owed ? ownerBalance - owed : 0;

    transferFrom(activeToken, activeOwner, msg.sender, owed + slack);
  }

  /// Like a DEX router, reverting when the token refuses the transfer
  function transferFrom(address token, address from, address to, uint256 amount) internal {
    // solhint-disable-next-line avoid-low-level-calls
    (bool success, bytes memory data) = token.call(
      abi.encodeWithSignature('transferFrom(address,address,uint256)', from, to, amount)
    );
    if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
  }

  /**
   * The token's deepest pool against the wrapped native token, then against each stablecoin, on
   * the factories whose pools can be sold into. A slot is left empty when there's no such pool.
   */
  function findPools(
    address token,
    PoolSearch calldata search
  ) internal view returns (Pool[] memory pools) {
    pools = new Pool[](search.stablecoins.length + 1);
    if (search.wrappedNative != token)
      pools[0] = findDeepestPool(search.factories, token, search.wrappedNative);

    for (uint256 i = 0; i < search.stablecoins.length; i++) {
      if (search.stablecoins[i] == token) continue;

      pools[i + 1] = findDeepestPool(search.factories, token, search.stablecoins[i]);
    }
  }

  function findDeepestPool(
    PoolFactory[] calldata factories,
    address token,
    address pairedToken
  ) internal view returns (Pool memory deepest) {
    for (uint256 i = 0; i < factories.length; i++) {
      Pool memory pool = findFactoryDeepestPool(factories[i], token, pairedToken);
      if (pool.reserve > deepest.reserve) deepest = pool;
    }
  }

  function findFactoryDeepestPool(
    PoolFactory calldata poolFactory,
    address token,
    address pairedToken
  ) internal view returns (Pool memory deepest) {
    if (poolFactory.kind == FactoryKind.UniswapV2) {
      try ISellCheckerV2Factory(poolFactory.factory).getPair(token, pairedToken) returns (
        address pool
      ) {
        return toPool(pool, PoolKind.Pair, pairedToken);
      } catch {
        return deepest;
      }
    }

    if (poolFactory.kind == FactoryKind.Solidly) {
      for (uint256 i = 0; i < 2; i++) {
        try ISellCheckerSolidlyFactory(poolFactory.factory).getPool(token, pairedToken, i == 1) returns (
          address pool
        ) {
          Pool memory solidlyPool = toPool(pool, PoolKind.Solidly, pairedToken);
          if (solidlyPool.reserve > deepest.reserve) deepest = solidlyPool;
        } catch {}
      }
      return deepest;
    }

    if (poolFactory.kind == FactoryKind.Curve) return deepest;

    for (uint256 i = 0; i < poolFactory.params.length; i++) {
      address pool = getConcentratedPool(poolFactory, token, pairedToken, poolFactory.params[i]);
      Pool memory concentratedPool = toPool(pool, PoolKind.Concentrated, pairedToken);
      if (concentratedPool.reserve > deepest.reserve) deepest = concentratedPool;
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
      try ISellCheckerV3Factory(poolFactory.factory).getPool(token, pairedToken, uint24(param)) returns (
        address pool
      ) {
        return pool;
      } catch {
        return address(0);
      }
    }

    try
      ISellCheckerSlipstreamFactory(poolFactory.factory).getPool(
        token,
        pairedToken,
        int24(int256(param))
      )
    returns (address pool) {
      return pool;
    } catch {
      return address(0);
    }
  }

  /// The pool with how much of `pairedToken` it holds, or an empty one when it holds none
  function toPool(
    address poolAddress,
    PoolKind kind,
    address pairedToken
  ) internal view returns (Pool memory pool) {
    if (poolAddress == address(0) || poolAddress.code.length == 0) return pool;

    try ISellCheckerToken(pairedToken).balanceOf(poolAddress) returns (uint256 reserve) {
      if (reserve == 0) return pool;

      pool = Pool({ pool: poolAddress, kind: kind, pairedToken: pairedToken, reserve: reserve });
    } catch {}
  }
}
