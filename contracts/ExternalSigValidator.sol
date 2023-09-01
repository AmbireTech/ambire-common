// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './libs/Transaction.sol';
import './HasMagicValues.sol';

/**
 * @title   ExternalSigValidator
 * @notice  A way to add custom recovery to AmbireAccount.
 * @dev     Not all passed properties necessarily need to be used.
 */
abstract contract ExternalSigValidator is HasMagicValues {
	function validateSig(
		address accountAddr,
		bytes calldata data,
		bytes calldata sig,
		Transaction[] calldata calls
	) external virtual returns (uint256);
}