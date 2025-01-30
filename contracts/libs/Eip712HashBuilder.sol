// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

library Eip712HashBuilder {
	function getHash(bytes32 hash) internal view returns (bytes32) {
		// TODO<7702>: configure the correct EIP-712 hash
		return hash;
	}
}