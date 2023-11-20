// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.7;

import './UserOperation.sol';

interface IEntryPoint {
  error ExecutionResult(
    uint256 preOpGas,
    uint256 paid,
    uint48 validAfter,
    uint48 validUntil,
    bool targetSuccess,
    bytes targetResult
  );

  function simulateHandleOp(
    UserOperation calldata op,
    address target,
    bytes calldata targetCallData
  ) external;
}
