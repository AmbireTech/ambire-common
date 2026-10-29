// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

import './IERC20.sol';

// Reads the metadata of a single token. It needs no account, as no balance is read.
contract TokenInfoGetter {
  // Gas limit for the whole read, to prevent gas-griefs from malicious token contracts
  uint256 private constant TOKEN_GAS_LIMIT = 425_000;

  struct TokenInfo {
    string name;
    string symbol;
    uint8 decimals;
  }

  function readTokenInfo(IERC20 token) external view returns (TokenInfo memory info) {
    info.name = token.name();
    info.symbol = token.symbol();
    info.decimals = token.decimals();
  }

  // Returns an empty result (no symbol) when the address is not a token or the read fails
  function getTokenInfo(IERC20 token) external view returns (TokenInfo memory info) {
    try this.readTokenInfo{ gas: TOKEN_GAS_LIMIT }(token) returns (TokenInfo memory result) {
      return result;
    } catch {}
  }
}
