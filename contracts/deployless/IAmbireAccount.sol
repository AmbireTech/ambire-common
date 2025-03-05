// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.7;

import '../libs/Transaction.sol';

interface IAmbireAccount {
	struct AmbireStorage {
		mapping(address => bytes32) privileges;
		uint256 nonce;
	}

	struct RecoveryInfo {
		address[] keys;
		uint timelock;
	}
	struct ExecuteArgs {
		Transaction[] calls;
		bytes signature;
	}

	// storage access methods
	function nonce() external view returns (uint256);
	function privileges(address key) external view returns (bytes32);

	function setAddrPrivilege(address addr, bytes32 priv) external payable;
	function tryCatch(address to, uint value, bytes calldata data) external payable;
	function tryCatchLimit(address to, uint value, bytes calldata data, uint gasLimit) external payable;

	function execute(Transaction[] calldata txns, bytes calldata signature) external payable;
	function executeBySender(Transaction[] calldata txns) external payable;
	function executeBySelf(Transaction[] calldata txns) external payable;
	function executeMultiple(ExecuteArgs[] calldata toExec) external payable;

	// EIP 1271 implementation
	// see https://eips.ethereum.org/EIPS/eip-1271
	function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
	function supportsInterface(bytes4 interfaceID) external view returns (bool);
}
