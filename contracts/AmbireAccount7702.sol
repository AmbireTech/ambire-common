// SPDX-License-Identifier: agpl-3.0

pragma solidity 0.8.19;
import "./AmbireAccount.sol";


contract AmbireAccount7702 is AmbireAccount {
	function privilegeLevel(address key) internal override view returns (uint256) {
		if (key == address(this)) return 2;
		return uint256(privileges[key]);
	}
}
