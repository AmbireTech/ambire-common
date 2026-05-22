// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

import './IERC20.sol';
import './IAmbireAccount.sol';
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
  struct BalancesAtNonce {
    TokenInfo[] balances;
    uint nonce;
  }

  function getERC20TokenInfo(
    IAmbireAccount account,
    IERC20 token
  ) external view returns (TokenInfo memory info) {
    info.amount = token.balanceOf(address(account));
    info.symbol = token.symbol();
    info.name = token.name();
    info.decimals = token.decimals();
  }

  function getERC20TokenBalance(
    IAmbireAccount account,
    IERC20 token
  ) external view returns (BalanceInfo memory info) {
    info.amount = token.balanceOf(address(account));
  }

  function getBalances(
    IAmbireAccount account,
    address[] calldata tokenAddrs
  ) public view returns (TokenInfo[] memory, uint256) {
    uint len = tokenAddrs.length;
    TokenInfo[] memory results = new TokenInfo[](len);
    for (uint256 i = 0; i < len; i++) {
      if (tokenAddrs[i] == address(0)) {
        results[i] = TokenInfo('ETH', 'Ether', address(account).balance, 18, bytes(''));
      } else {
        try this.getERC20TokenInfo{ gas: TOKEN_GAS_LIMIT }(account, IERC20(tokenAddrs[i])) returns (
          TokenInfo memory info
        ) {
          results[i] = info;
        } catch (bytes memory e) {
          results[i].error = e.length > 0 ? e : bytes('unkn');
        }
      }
    }
    return (results, block.number);
  }

  function getBalancesWithInfo(
    IAmbireAccount account,
    address[] calldata tokenAddrs
  ) public view returns (TokenInfo[] memory, uint, uint) {
    (TokenInfo[] memory results, uint blockNumber) = getBalances(account, tokenAddrs);
    return (results, gasleft(), blockNumber);
  }

  function getBalancesOf(
    IAmbireAccount account,
    address[] calldata tokenAddrs
  ) public view returns (BalanceInfo[] memory) {
    uint len = tokenAddrs.length;
    BalanceInfo[] memory results = new BalanceInfo[](len);

    for (uint256 i = 0; i < len; i++) {
      if (tokenAddrs[i] == address(0)) {
        results[i] = BalanceInfo(address(account).balance, bytes(''));
      } else {
        try
          this.getERC20TokenBalance{ gas: TOKEN_GAS_LIMIT }(account, IERC20(tokenAddrs[i]))
        returns (BalanceInfo memory balanceInfo) {
          results[i] = balanceInfo;
        } catch (bytes memory e) {
          results[i].error = e.length > 0 ? e : bytes('unkn');
        }
      }
    }
    return results;
  }

  function getDelta(
    TokenInfo[] memory balancesA,
    BalanceInfo[] memory balancesB,
    address[] calldata tokenAddrs
  ) internal pure returns (TokenInfo[] memory, address[] memory) {
    uint deltaSize = 0;

    for (uint256 i = 0; i < balancesA.length; i++) {
      if (balancesA[i].amount != balancesB[i].amount) {
        deltaSize++;
      }
    }

    TokenInfo[] memory delta = new TokenInfo[](deltaSize);

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
    // instead of passing {factory, code, salt}, we'll just have factory and factoryCalldata
    address factory,
    bytes memory factoryCalldata,
    Simulation.ToSimulate[] calldata toSimulate
  )
    external
    returns (
      BalancesAtNonce memory before,
      BalancesAtNonce memory afterSimulation,
      bytes memory /*simulationError*/,
      uint /*gasLeft*/,
      uint /*blockNum*/,
      address[] memory // deltaAddressesMapping
    )
  {
    address[] memory deltaAddressesMapping = new address[](0);
    (TokenInfo[] memory results, ) = getBalances(account, tokenAddrs);
    before.balances = results;
    (uint startNonce, bool success, bytes memory err) = Simulation.simulate(
      account,
      associatedKeys,
      factory,
      factoryCalldata,
      toSimulate
    );
    before.nonce = startNonce;

    if (!success) {
      return (before, afterSimulation, err, gasleft(), block.number, deltaAddressesMapping);
    }

    afterSimulation.nonce = account.nonce();
    if (afterSimulation.nonce != before.nonce) {
      // take only the changed balances, no need to fetch the metadata again
      BalanceInfo[] memory resultsAfterSimulation = getBalancesOf(account, tokenAddrs);
      (afterSimulation.balances, deltaAddressesMapping) = getDelta(
        before.balances,
        resultsAfterSimulation,
        tokenAddrs
      );
    }

    return (before, afterSimulation, bytes(''), gasleft(), block.number, deltaAddressesMapping);
  }
}
