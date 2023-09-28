// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './AmbireAccount.sol';
import './libs/erc4337/IPaymaster.sol';

contract AmbirePaymaster is IPaymaster {
	address immutable public relayer;

	constructor(address _relayer) {
		relayer = _relayer;
	}

	/**
	 * @notice  This method can be used to withdraw stuck tokens or airdrops 
	 * We do not need to handle ETH as well since depositTo can be invoked from anywhere.
	 * As well as to call the EntryPoint to withdraw tokens (withdrawTo). We need a withdraw method though.
	 * @param   to  The address we're calling
	 * @param   value  The value in the call
	 * @param	data	the call data
	 * @param	gas	the call gas
	 */
	function call(address to, uint256 value, bytes calldata data, uint256 gas) external {
		require(msg.sender == relayer, 'call: not relayer');
		(bool success, bytes memory err) = to.call{ gas: gas, value: value }(data);
		require(success, string(err));
	}

	/**
	 * @notice  Validate user operations the paymaster has signed
	 * We do not need to send funds to the EntryPoint because we rely on pre-existing deposit.
	 * Requests are chain specific to prevent signature reuse.
	 * @dev     .
	 * @param   userOp  .
	 * @return  context  .
	 * @return  validationData  .
	 */
	function validatePaymasterUserOp(UserOperation calldata userOp, bytes32, uint256)
		external
		view
		returns (bytes memory context, uint256 validationData)
	{
		// parse the paymasterAndData
		(uint48 validUntil, uint48 validAfter, bytes memory signature) = abi.decode(userOp.paymasterAndData[20:], (uint48, uint48, bytes));

		// NOTE: we do not need to send funds to the EntryPoint because we rely on pre-existing deposit
		bytes32 hash = keccak256(abi.encode(
			block.chainid,
			address(this),
			validUntil,
			validAfter,
			// everything except paymasterAndData and signature
			userOp.sender,
			// for the nonce we have an exception case: one-time nonces depend on paymasterAndData, which is generated by the relayer
			// we can't have this as part of the sig cuz we create a cyclical dep
			// the nonce can only be used once, so one cannot replay the gas payment
			userOp.callData.length >= 4 && bytes4(userOp.callData[0:4]) == AmbireAccount.execute.selector ? 0 : userOp.nonce,
			userOp.initCode,
			userOp.callData,
			userOp.callGasLimit,
			userOp.verificationGasLimit,
			userOp.preVerificationGas,
			userOp.maxFeePerGas,
			userOp.maxPriorityFeePerGas
		));
		bool isValidSig = SignatureValidator.recoverAddr(hash, signature) == relayer;
		// see _packValidationData: https://github.com/eth-infinitism/account-abstraction/blob/f2b09e60a92d5b3177c68d9f382912ccac19e8db/contracts/core/Helpers.sol#L73-L80
		return ("", uint160(isValidSig ? 0 : 1) | (uint256(validUntil) << 160) | (uint256(validAfter) << 208));
	}

	/**
	 * @notice  No-op, won't be used because we don't return a context
	 * @param   mode  .
	 * @param   context  .
	 * @param   actualGasCost  .
	 */
	function postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost) external {
		// No-op, won't be used because we don't return a context
	}
}
