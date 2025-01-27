// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './AmbireAccount.sol';

/**
 * @notice A contract that extends AmbireAccount to make it 7702 adaptable
 * @dev We hardcode the entry point address so we don't have to use
 * any storage slots after authorization. If it changes, the users
 * will have to authrorize another contract with the new entry point addr
 * to continue
 */
contract AmbireAccount7702 is AmbireAccount {
	address private constant ENTRY_POINT = address(0x0000000071727De22E5E9d8BAf0edAc6f37da032);

	function privileges(address key) public override view returns (bytes32) {
		if (key == address(this)) return bytes32(uint256(2));

		// if the entry point is the sender, we return the marker priv
		if (key == ENTRY_POINT) return ENTRY_POINT_MARKER;

		return getAmbireStorage().privileges[key];
	}
}