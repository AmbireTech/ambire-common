// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

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

