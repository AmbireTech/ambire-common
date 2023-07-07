// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

import "./IAmbireAccount.sol";

contract Simulation {
	struct ToSimulate {
		uint nonce;
		IAmbireAccount.Transaction[] txns;
		bytes signature;
	}

	function simulate(
		IAmbireAccount account,
		address factory, bytes memory factoryCalldata,
		ToSimulate[] calldata toSimulate
	) public returns (uint startingNonce, bool, bytes memory) {
		if (address(account).code.length == 0) {
			(bool success, bytes memory err) = factory.call(factoryCalldata);
			if (!success) return (0, false, err);
		}

		startingNonce = account.nonce();
		for (uint256 i = 0; i < toSimulate.length; i++) {
			if (account.nonce() == toSimulate[i].nonce) {
				try account.execute(toSimulate[i].txns, toSimulate[i].signature) {} catch (bytes memory err) {
					return (startingNonce, false, err);
				}
			}
		}

		return (startingNonce, true, bytes(""));
	}
}
