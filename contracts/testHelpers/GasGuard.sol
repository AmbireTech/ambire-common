// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * The purpose of this contract is purely for testing purposes.
 * Estimation.sol predicts very accurately the gas limit but found it
 * difficult to do so when the UI demanded a predefined gas limit like
 * the case in this contract.
 * So we implemented a binary search in Estimation.sol and are using
 * this contract to test if it works as it should
 */
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
