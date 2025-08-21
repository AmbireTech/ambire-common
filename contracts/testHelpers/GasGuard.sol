// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract GasGuard {
  uint256 lastGas;

  error InsufficientGas(uint256 gasLeft, uint256 required);

  function guardedCall(uint256 minGasRequired) external returns (uint256) {
    uint256 g = gasleft();
    lastGas = g;

    if (g < minGasRequired) {
      revert InsufficientGas(g, minGasRequired);
    }

    return g;
  }
}
