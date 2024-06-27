// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

import './IERC20.sol';
import './IAmbireAccount.sol';
import './Simulation.sol';

contract BalanceGetter is Simulation {
  // Knowing the exact source of the error would be great, but we can always change this as this contract is meant to be called off-chain

  // During simulation, we return the delta between the balances before and after the simulation.
  // This array maintains a mapping between the indices of the passed-in token addresses and the tokens listed in the delta array.
  // While returning the token address directly in the before/after balances would be more straightforward,
  // it would result in heavier data for larger token portfolios, making it more CPU-intensive to parse with ethers.
  address[] private deltaAddressesMapping;

  struct Approval {
    address spender;
    uint allowance;
  }
  struct TokenInfo {
    string symbol;
    uint256 amount;
    uint8 decimals;
    bytes error;
    Approval[] approvals;
  }
  struct BalancesAtNonce {
    TokenInfo[] balances;
    uint nonce;
  }

  function getERC20TokenInfo(
    IAmbireAccount account,
    IERC20 token,
    address[] memory spenders
  ) external view returns (TokenInfo memory info) {
    info.amount = token.balanceOf(address(account));
    info.symbol = token.symbol();
    info.decimals = token.decimals();
    for (uint256 i = 0; i < spenders.length; i++) {
      Approval memory approval;
      approval.spender = spenders[i];
      approval.allowance = token.allowance(address(account), spenders[i]);
      info.approvals[i] = approval;
    }
  }

  function getBalances(
    IAmbireAccount account,
    address[] calldata tokenAddrs,
    address[] memory spenders
  ) public view returns (TokenInfo[] memory) {
    uint len = tokenAddrs.length;
    TokenInfo[] memory results = new TokenInfo[](len);
    for (uint256 i = 0; i < len; i++) {
      if (tokenAddrs[i] == address(0)) {
        Approval[] memory approvals;
        results[i] = TokenInfo('ETH', address(account).balance, 18, bytes(''), approvals);
      } else {
        try this.getERC20TokenInfo(account, IERC20(tokenAddrs[i]), spenders) returns (
          TokenInfo memory info
        ) {
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
    address[] memory spenders;
    return (getBalances(account, tokenAddrs, spenders), gasleft(), block.number);
  }

  // Compare the tokens balances before (balancesA) and after simulation (balancesB)
  // and return the delta (with simulation)
  function getDelta(
    TokenInfo[] memory balancesA,
    TokenInfo[] memory balancesB,
    address[] calldata tokenAddrs
  ) public returns (TokenInfo[] memory) {
    uint deltaSize = 0;

    for (uint256 i = 0; i < balancesA.length; i++) {
      if (balancesA[i].amount != balancesB[i].amount) {
        deltaSize++;
      }
    }

    TokenInfo[] memory delta = new TokenInfo[](deltaSize);
    deltaAddressesMapping = new address[](deltaSize);

    // Second loop to populate the delta array
    // Separate index for the delta array
    uint256 deltaIndex = 0;
    for (uint256 i = 0; i < balancesA.length; i++) {
      if (balancesA[i].amount != balancesB[i].amount) {
        delta[deltaIndex] = balancesB[i];
        deltaAddressesMapping[deltaIndex] = tokenAddrs[i];
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
    Simulation.ToSimulate[] calldata toSimulate,
    address[] memory spenders // token approval spenders
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
    before.balances = getBalances(account, tokenAddrs, spenders);

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
      afterSimulation.balances = getBalances(account, tokenAddrs, spenders);

      TokenInfo[] memory deltaAfter = getDelta(
        before.balances,
        afterSimulation.balances,
        tokenAddrs
      );
      afterSimulation.balances = deltaAfter;
    }

    return (before, afterSimulation, bytes(''), gasleft(), block.number, deltaAddressesMapping);
  }
}
