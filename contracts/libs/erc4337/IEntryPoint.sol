// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.7;

// EIP-4337 UserOperation
// https://eips.ethereum.org/EIPS/eip-4337#required-entry-point-contract-functionality
struct UserOperation {
	address sender;
	uint256 nonce;
	bytes initCode;
	bytes callData;
	uint256 callGasLimit;
	uint256 verificationGasLimit;
	uint256 preVerificationGas;
	uint256 maxFeePerGas;
	uint256 maxPriorityFeePerGas;
	bytes paymasterAndData;
	bytes signature;
}


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
