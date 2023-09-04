// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './libs/Transaction.sol';

/**
 * @title   ExternalSigValidator
 * @notice  A way to add custom recovery to AmbireAccount.
 * @dev     Not all passed properties necessarily need to be used.
 */
interface ExternalSigValidator {
	function validateSig(
		address accountAddr,
		bytes calldata data,
		bytes calldata sig,
		uint256 nonce,
		Transaction[] calldata calls
	) external returns (bool shouldExecute);
}