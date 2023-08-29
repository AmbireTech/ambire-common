// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.7;

interface IAmbireAccount {
	function privileges(address addr) external returns (bytes32);
	function nonce() external returns (uint);
	function scheduledRecoveries(bytes32 hash) external returns (uint);

	struct Transaction {
		address to;
		uint value;
		bytes data;
	}
	struct RecoveryInfo {
		address[] keys;
		uint timelock;
	}
	struct ExecuteArgs {
		Transaction[] calls;
		bytes signature;
	}

	function setAddrPrivilege(address addr, bytes32 priv) external;
	function tryCatch(address to, uint value, bytes calldata data) external;
	function tryCatchLimit(address to, uint value, bytes calldata data, uint gasLimit) external;

	function execute(Transaction[] calldata txns, bytes calldata signature) external;
	function executeBySender(Transaction[] calldata txns) external;
	function executeBySelf(Transaction[] calldata txns) external;
	function executeMultiple(ExecuteArgs[] calldata toExec) external payable;

	// EIP 1271 implementation
	// see https://eips.ethereum.org/EIPS/eip-1271
	function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
	function supportsInterface(bytes4 interfaceID) external pure returns (bool);
}

interface ExternalSigValidator {
	function validateSig(
		address accountAddr,
		bytes calldata data,
		bytes calldata sig,
		IAmbireAccount.Transaction[] calldata calls
	) external returns (bool shouldExecute);
}