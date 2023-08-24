// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

// Must inherit AmbireAccount so that it's safe to delegatecall (doesn't override storage)
import "./AmbireAccount.sol";
import "./libs/SignatureValidator.sol";
import "../node_modules/@account-abstraction/contracts/interfaces/IAccount.sol";

contract AmbireERC4337Manager is AmbireAccount, IAccount {
	// return value in case of signature failure, with no time-range.
	// equivalent to packSigTimeRange(true,0,0);
	uint256 constant internal SIG_VALIDATION_FAILED = 1;

	// aggregator is unused, we don't use sig aggregation
	function validateUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
    external returns (uint256 validationData)
	{
		// we don't know which is the entry point but it's pretty safe
		// to allow privileges[msg.sender] to proceed
		require(privileges[msg.sender] != bytes32(0), 'INSUFFICIENT_PRIVILEGE');

		address signer = SignatureValidator.recoverAddr(userOpHash, userOp.signature);
		if (privileges[signer] == bytes32(0)) {
			validationData = SIG_VALIDATION_FAILED;
			return validationData;
		}

		if (missingAccountFunds > 0) {
			// TODO: MAY pay more than the minimum, to deposit for future transactions
			(bool success,) = payable(msg.sender).call{value : missingAccountFunds}("");
			(success);
			// ignore failure (its EntryPoint's job to verify, not account.)
		}

		return 0; // always return 0 as this function doesn't support time based validation
	}
}