// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

import './IERC20.sol';
import './IAmbireAccount.sol';
import './Simulation.sol';

contract BalanceGetter is Simulation {
  // Knowing the exact source of the error would be great, but we can always change this as this contract is meant to be called off-chain

  struct TokenInfo {
    string symbol;
    address addr;
    uint256 amount;
    uint8 decimals;
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
    info.addr = address(token);
    info.amount = token.balanceOf(address(account));
    info.symbol = token.symbol();
    info.decimals = token.decimals();
  }

  function getBalances(
    IAmbireAccount account,
    address[] calldata tokenAddrs
  ) public view returns (TokenInfo[] memory) {
    uint len = tokenAddrs.length;
    TokenInfo[] memory results = new TokenInfo[](len);
    for (uint256 i = 0; i < len; i++) {
      if (tokenAddrs[i] == address(0)) {
        results[i] = TokenInfo('ETH', tokenAddrs[i], address(account).balance, 18, bytes(''));
      } else {
        try this.getERC20TokenInfo(account, IERC20(tokenAddrs[i])) returns (TokenInfo memory info) {
          results[i] = info;
        } catch (bytes memory e) {
          results[i].error = e.length > 0 ? e : bytes('unkn');
        }
      }
    }
    return results;
  }

  function getBalancesWithInfo(
    IAmbireAccount account,
    address[] calldata tokenAddrs
  ) public view returns (TokenInfo[] memory, uint, uint) {
    return (getBalances(account, tokenAddrs), gasleft(), block.number);
  }

  // Compare the tokens balances before (balancesA) and after simulation (balancesB)
  // and return the delta (with simulation)
  function getDelta(TokenInfo[] memory balancesA, TokenInfo[] memory balancesB) public pure returns (TokenInfo[] memory) {
    uint deltaSize = 0;

    for (uint256 i = 0; i < balancesA.length; i++) {
      if (balancesA[i].amount != balancesB[i].amount) {
        deltaSize++;
      }
    }

    TokenInfo[] memory delta = new TokenInfo[](deltaSize);

    // Second loop to populate the delta array
    // Separate index for the delta array
    uint256 deltaIndex = 0;
    for (uint256 i = 0; i < balancesA.length; i++) {
      if (balancesA[i].amount != balancesB[i].amount) {
        delta[deltaIndex] = balancesB[i];
        deltaIndex++;
      }
    }

    return delta;
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
      uint /*blockNum*/
    )
  {
    before.balances = getBalances(account, tokenAddrs);

    (uint startNonce, bool success, bytes memory err) = Simulation.simulate(
      account,
      associatedKeys,
      factory,
      factoryCalldata,
      toSimulate
    );
    before.nonce = startNonce;

    if (!success) {
      return (before, afterSimulation, err, gasleft(), block.number);
    }

    afterSimulation.nonce = account.nonce();
    if (afterSimulation.nonce != before.nonce) {
      afterSimulation.balances = getBalances(account, tokenAddrs);

      (TokenInfo[] memory deltaAfter) = getDelta(before.balances, afterSimulation.balances);
      afterSimulation.balances = deltaAfter;
    }

    return (before, afterSimulation, bytes(''), gasleft(), block.number);
  }
}
