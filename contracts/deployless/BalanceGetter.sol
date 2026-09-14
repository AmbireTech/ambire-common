// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

import './IERC20.sol';
import './IAmbireAccount.sol';
import './MetaFlags.sol';
import './Simulation.sol';

contract BalanceGetter is Simulation {
  // Knowing the exact source of the error would be great, but we can always change this as this contract is meant to be called off-chain

  // add a per-token gas limit to prevent gas-griefs
  uint256 private constant TOKEN_GAS_LIMIT = 425_000;

  struct TokenInfo {
    string symbol;
    string name;
    uint256 amount;
    uint8 decimals;
    bytes error;
  }
  struct BalanceInfo {
    uint256 amount;
    bytes error;
  }
  struct TokenMeta {
    string symbol;
    string name;
    uint8 decimals;
  }
  struct BalanceAmountsAtNonce {
    BalanceInfo[] balances;
    uint nonce;
  }

  function getERC20TokenInfo(
    IAmbireAccount account,
    IERC20 token,
    bool withMeta
  ) external view returns (TokenInfo memory info) {
    info.amount = token.balanceOf(address(account));

    if (!withMeta) return info;

    info.symbol = token.symbol();
    info.name = token.name();
    info.decimals = token.decimals();
  }

  // Balances for every token, metadata for the ones metaFlags points at. A single call
  // per token reads both, so asking for metadata costs no extra call and no extra gas
  // allowance, and a token the caller already knows costs one balance read.
  function getBalancesAndMetas(
    IAmbireAccount account,
    address[] calldata tokenAddrs,
    // Passing a second array of addresses makes the call more expensive, so we use a single array of flags instead.
    bytes memory metaFlags
  ) public view returns (BalanceInfo[] memory, TokenMeta[] memory) {
    uint len = tokenAddrs.length;
    BalanceInfo[] memory balances = new BalanceInfo[](len);
    TokenMeta[] memory metas = new TokenMeta[](MetaFlags.count(metaFlags, len));
    uint metaIndex = 0;

    for (uint256 i = 0; i < len; i++) {
      bool withMeta = MetaFlags.has(metaFlags, i);

      if (tokenAddrs[i] == address(0)) {
        balances[i] = BalanceInfo(address(account).balance, bytes(''));
        if (withMeta) {
          metas[metaIndex] = TokenMeta('ETH', 'Ether', 18);
          metaIndex++;
        }
        continue;
      }

      try
        this.getERC20TokenInfo{ gas: TOKEN_GAS_LIMIT }(account, IERC20(tokenAddrs[i]), withMeta)
      returns (TokenInfo memory info) {
        balances[i] = BalanceInfo(info.amount, bytes(''));
        if (withMeta) {
          metas[metaIndex] = TokenMeta(info.symbol, info.name, info.decimals);
          metaIndex++;
        }
      } catch (bytes memory e) {
        balances[i].error = e.length > 0 ? e : bytes('unkn');
        // The entry is left empty, the caller reads the error off the balance
        if (withMeta) metaIndex++;
      }
    }

    return (balances, metas);
  }

  function getBalances(
    IAmbireAccount account,
    address[] calldata tokenAddrs,
    bytes calldata metaFlags
  ) public view returns (BalanceInfo[] memory, TokenMeta[] memory, uint256) {
    (BalanceInfo[] memory balances, TokenMeta[] memory metas) = getBalancesAndMetas(
      account,
      tokenAddrs,
      metaFlags
    );

    return (balances, metas, block.number);
  }

  function getDelta(
    BalanceInfo[] memory balancesA,
    BalanceInfo[] memory balancesB,
    address[] calldata tokenAddrs
  ) internal pure returns (BalanceInfo[] memory, address[] memory) {
    uint deltaSize = 0;

    for (uint256 i = 0; i < balancesA.length; i++) {
      if (balancesA[i].amount != balancesB[i].amount) {
        deltaSize++;
      }
    }

    BalanceInfo[] memory delta = new BalanceInfo[](deltaSize);

    // During simulation, we return the delta between the balances before and after the simulation.
    // This array maintains a mapping between the indices of the passed-in token addresses and the tokens listed in the delta array.
    // While returning the token address directly in the after-simulation balances would be more straightforward,
    // it would result in heavier data for larger token portfolios, making it more CPU-intensive to parse with ethers.
    address[] memory deltaAddressesMapping = new address[](deltaSize);

    uint256 deltaIndex = 0;
    for (uint256 i = 0; i < balancesA.length; i++) {
      if (balancesA[i].amount != balancesB[i].amount) {
        delta[deltaIndex].amount = balancesB[i].amount;
        delta[deltaIndex].error = balancesB[i].error;
        deltaAddressesMapping[deltaIndex] = tokenAddrs[i];
        deltaIndex++;
      }
    }

    return (delta, deltaAddressesMapping);
  }

  function simulateAndGetBalances(
    IAmbireAccount account,
    address[] memory associatedKeys,
    address[] calldata tokenAddrs,
    bytes calldata metaFlags,
    // instead of passing {factory, code, salt}, we'll just have factory and factoryCalldata
    address factory,
    bytes memory factoryCalldata,
    Simulation.ToSimulate[] calldata toSimulate
  )
    external
    returns (
      BalanceAmountsAtNonce memory before,
      BalanceAmountsAtNonce memory afterSimulation,
      TokenMeta[] memory metas,
      bytes memory /*simulationError*/,
      uint /*gasLeft*/,
      uint /*blockNum*/,
      address[] memory // deltaAddressesMapping
    )
  {
    address[] memory deltaAddressesMapping = new address[](0);
    (before.balances, metas) = getBalancesAndMetas(account, tokenAddrs, metaFlags);
    (uint startNonce, bool success, bytes memory err) = Simulation.simulate(
      account,
      associatedKeys,
      factory,
      factoryCalldata,
      toSimulate
    );
    before.nonce = startNonce;

    if (!success) {
      return (before, afterSimulation, metas, err, gasleft(), block.number, deltaAddressesMapping);
    }

    afterSimulation.nonce = account.nonce();
    if (afterSimulation.nonce != before.nonce) {
      // take only the changed balances, no need to fetch the metadata again
      (BalanceInfo[] memory balancesAfter, ) = getBalancesAndMetas(account, tokenAddrs, bytes(''));
      (afterSimulation.balances, deltaAddressesMapping) = getDelta(
        before.balances,
        balancesAfter,
        tokenAddrs
      );
    }

    return (
      before,
      afterSimulation,
      metas,
      bytes(''),
      gasleft(),
      block.number,
      deltaAddressesMapping
    );
  }
}
