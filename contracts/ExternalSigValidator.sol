// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './AmbireAccount.sol';

interface ExternalSigValidator {
	function validateSig(
		address accountAddr,
		bytes calldata data,
		bytes calldata sig,
		AmbireAccount.Transaction[] calldata calls
	) external;
}