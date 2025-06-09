// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './deployless/IAmbireAccount.sol';
import './libs/erc4337/IPaymaster.sol';
import './libs/SignatureValidator.sol';
import './libs/erc4337/UserOpHelper.sol';

contract AmbirePaymaster is IPaymaster {

	address immutable public relayer;

	constructor(address _relayer) {
		relayer = _relayer;
	}

	/**
	 * @notice  This method can be used to withdraw stuck tokens or airdrops
	 *
	 * @param   to  The address we're calling
	 * @param   value  The value in the call
	 * @param	data	the call data
	 * @param	gas	the call gas
	 */
	function call(address to, uint256 value, bytes calldata data, uint256 gas) external payable {
		require(msg.sender == relayer, 'call: not relayer');
		(bool success, bytes memory err) = to.call{ gas: gas, value: value }(data);
		require(success, string(err));
	}

	/**
	 * @notice  Validate user operations the paymaster has signed
	 * We do not need to send funds to the EntryPoint because we rely on pre-existing deposit.
	 * Requests are chain specific to prevent signature reuse.
	 * @dev     We have two use cases for the paymaster:
	 * - normal erc-4337. Everything is per ERC-4337 standard, the nonce is sequential.
	 * - an executeMultiple call. If the calldata is executeMultiple, we've hardcoded
	 * a 0 nonce. That's what's called a one-time hash nonce and its key is actually
	 * the commitment. Check EntryPoint -> NonceManager for more information.
	 *
	 * @param   userOp  the UserOperation we're executing
	 * @return  context  context is returned in the postOp and called by the
	 * EntryPoint. But we're not using postOp is context is always emtpy
	 * @return  validationData  This consists of:
	 * - an aggregator address: address(uint160(validationData)). This is used
	 * when you want an outer contract to determine whether the signature is valid.
	 * In our case, this is always 0 (address 0) for valid signatures and
	 * 1 (address 1) for invalid. This is what the entry point expects and
	 * in those two cases, an outer contract is obviously not called.
	 * - a uint48 validUntil: uint48(validationData >> 160)
	 * A Paymaster signature can be signed at time "x" but delayed intentionally
	 * until time "y" when a fee payment's price has dropped significantly or
	 * some other issue. validUntil sets a time validity for the signature
     * - a uint48 validAfter: uint48(validationData >> (48 + 160))
	 * If the signature should be valid only after a period of time,
	 * we tweak the validAfter property.
	 * For more information, check EntryPoint -> _getValidationData()
	 */
	function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256)
		external
		view
		returns (bytes memory context, uint256 validationData)
	{
		(uint48 validUntil, uint48 validAfter, bytes memory signature) = abi.decode(
			userOp.paymasterAndData[UserOpHelper.PAYMASTER_DATA_OFFSET:],
			(uint48, uint48, bytes)
		);

		bytes memory callData = userOp.callData;
		bytes32 hash = keccak256(abi.encode(
			block.chainid,
			address(this),
			// entry point
			msg.sender,
			validUntil,
			validAfter,
			// everything except paymasterAndData and signature
			userOp.sender,
			userOp.nonce,
			userOp.initCode,
			callData,
			userOp.accountGasLimits,
			userOp.preVerificationGas,
			userOp.gasFees
		));
		(address recovered, ) = SignatureValidator.recoverAddrAllowUnprotected(hash, signature, true);
		bool isValidSig = recovered == relayer;
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
