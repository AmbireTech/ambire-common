// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './libs/Transaction.sol';

/**
 * @title   ExternalSigValidator
 * @notice  A way to add custom recovery to AmbireAccount.
 * address accountAddr is the Ambire account address
 * bytes calldata data is all the data needed by the ExternalSigValidator.
 * It could be anything and it's validator specific.
 * bytes calldata sig is the signature we're validating. Notice its not
 * bytes32 so there could be cases where its not only the signature. It's
 * validator specific
 * uint256 nonce - the Ambire account nonce
 * Transaction[] calldata calls - the txns that are going to be executed
 * if the validation is successful
 * @dev     Not all passed properties necessarily need to be used.
 */
abstract contract ExternalSigValidator {
	function validateSig(
		bytes calldata data,
		bytes calldata sig,
		Transaction[] calldata calls
	) external virtual returns (bool isValidSignature, uint256 timestampValidAfter);
}