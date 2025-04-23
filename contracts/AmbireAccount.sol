// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './libs/SignatureValidator.sol';
import './ExternalSigValidator.sol';
import './libs/erc4337/PackedUserOperation.sol';
import './libs/erc4337/UserOpHelper.sol';
import './deployless/IAmbireAccount.sol';
import './libs/Eip712HashBuilder.sol';

/**
 * @notice  A validator that performs DKIM signature recovery
 * @dev     All external/public functions (that are not view/pure) use `payable` because AmbireAccount
 * is a wallet contract, and any ETH sent to it is not lost, but on the other hand not having `payable`
 * makes the Solidity compiler add an extra check for `msg.value`, which in this case is wasted gas
 */
contract AmbireAccount is IAmbireAccount {
	// @dev We do not have a constructor. This contract cannot be initialized with any valid `privileges` by itself!
	// The intended use case is to deploy one base implementation contract, and create a minimal proxy for each user wallet, by
	// using our own code generation to insert SSTOREs to initialize `privileges` (it was previously called IdentityProxyDeploy.js, now src/libs/proxyDeploy/deploy.ts)

	// @dev This is how we understand if msg.sender is the entry point
	bytes32 constant ENTRY_POINT_MARKER = 0x0000000000000000000000000000000000000000000000000000000000007171;

	// Externally validated signatures
	uint8 private constant SIGMODE_EXTERNALLY_VALIDATED = 255;

	bytes32 constant AMBIRE_STORAGE_POSITION = keccak256("ambire.smart.contracts.storage");

	// Events
	event LogPrivilegeChanged(address indexed addr, bytes32 priv);
	event LogErr(address indexed to, uint256 value, bytes data, bytes returnData); // only used in tryCatch

	// This contract can accept ETH without calldata
	receive() external payable {}

	/**
	 * @dev     To support EIP 721 and EIP 1155, we need to respond to those methods with their own method signature
	 * @return  bytes4  onERC721Received function selector
	 */
	function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
		return this.onERC721Received.selector;
	}

	/**
	 * @dev     To support EIP 721 and EIP 1155, we need to respond to those methods with their own method signature
	 * @return  bytes4  onERC1155Received function selector
	 */
	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return this.onERC1155Received.selector;
	}

	/**
	 * @dev     To support EIP 721 and EIP 1155, we need to respond to those methods with their own method signature
	 * @return  bytes4  onERC1155Received function selector
	 */
	function onERC1155BatchReceived(
		address,
		address,
		uint256[] calldata,
		uint256[] calldata,
		bytes calldata
	) external pure returns (bytes4) {
		return this.onERC1155BatchReceived.selector;
	}

	/**
	 * @notice  nothing to do here
	 * @dev     this contract can accept ETH with calldata, hence payable
	 */
	fallback() external payable {
	}

	function getAmbireStorage() internal pure returns (AmbireStorage storage ds) {
		bytes32 position = AMBIRE_STORAGE_POSITION;
		assembly {
			ds.slot := position
		}
	}

	function nonce() external view returns (uint256) {
		return getAmbireStorage().nonce;
	}

	function privileges(address key) public virtual view returns (bytes32) {
		return getAmbireStorage().privileges[key];
	}

	/**
	 * @notice  used to set the privilege of a key (by `addr`)
	 * @dev     normal signatures will be considered valid if the
	 * `addr` they are signed with has non-zero (not 0x000..000) privilege set; we can set the privilege to
	 * a hash of the recovery keys and timelock (see `RecoveryInfo`) to enable recovery signatures
	 * @param   addr  the address to give privs to
	 * @param   priv  the privs to give
	 */
	function setAddrPrivilege(address addr, bytes32 priv) external payable {
		require(msg.sender == address(this), 'ONLY_ACCOUNT_CAN_CALL');
		getAmbireStorage().privileges[addr] = priv;
		emit LogPrivilegeChanged(addr, priv);
	}

	/**
	 * @notice  Useful when we need to do multiple operations but ignore failures in some of them
	 * @param   to  address we're sending value to
	 * @param   value  the amount
	 * @param   data  callData
	 */
	function tryCatch(address to, uint256 value, bytes calldata data) external payable {
		require(msg.sender == address(this), 'ONLY_ACCOUNT_CAN_CALL');
		uint256 gasBefore = gasleft();
		(bool success, bytes memory returnData) = to.call{ value: value, gas: gasBefore }(data);
		require(gasleft() > gasBefore / 64, 'TRYCATCH_OOG');
		if (!success) emit LogErr(to, value, data, returnData);
	}

	/**
	 * @notice  same as `tryCatch` but with a gas limit
	 * @param   to  address we're sending value to
	 * @param   value  the amount
	 * @param   data  callData
	 * @param   gasLimit  how much gas is allowed
	 */
	function tryCatchLimit(address to, uint256 value, bytes calldata data, uint256 gasLimit) external payable {
		require(msg.sender == address(this), 'ONLY_ACCOUNT_CAN_CALL');
		uint256 gasBefore = gasleft();
		(bool success, bytes memory returnData) = to.call{ value: value, gas: gasLimit }(data);
		require(gasleft() > gasBefore / 64, 'TRYCATCH_OOG');
		if (!success) emit LogErr(to, value, data, returnData);
	}

	/**
	 * @notice  execute: this method is used to execute a single bundle of calls that are signed with a key
	 * that is authorized to execute on this account (in `privileges`)
	 * @dev     WARNING: if the signature of this is changed, we have to change AmbireAccountFactory
	 * @param   calls  the transaction we're executing. They may not execute
	 * if specific cases. One such is when setting a timelock
	 * @param   signature  the signature for the transactions
	 */
	function execute(Transaction[] calldata calls, bytes calldata signature) public payable {
		address signerKey;
		uint8 sigMode = uint8(signature[signature.length - 1]);
		uint256 currentNonce = getAmbireStorage().nonce;
		// we increment the nonce here (not using `nonce++` to save some gas)
		getAmbireStorage().nonce = currentNonce + 1;

		if (sigMode == SIGMODE_EXTERNALLY_VALIDATED) {
			bool isValidSig;
			uint256 timestampValidAfter;
			(signerKey, isValidSig, timestampValidAfter) = validateExternalSig(calls, signature);
			if (!isValidSig) {
				require(block.timestamp >= timestampValidAfter, 'SIGNATURE_VALIDATION_TIMELOCK');
				revert('SIGNATURE_VALIDATION_FAIL');
			}
		} else {
			(signerKey, ) = SignatureValidator.recoverAddrAllowUnprotected(
				Eip712HashBuilder.getExecute712Hash(
					currentNonce,
					calls,
					keccak256(abi.encode(address(this), block.chainid, currentNonce, calls))
				),
				signature,
				true
			);
			require(privileges(signerKey) != bytes32(0), 'INSUFFICIENT_PRIVILEGE');
		}

		executeBatch(calls);

		// The actual anti-bricking mechanism - do not allow a signerKey to drop their own privileges
		require(privileges(signerKey) != bytes32(0), 'PRIVILEGE_NOT_DOWNGRADED');
	}

	/**
	 * @notice  allows executing multiple bundles of calls (batch together multiple executes)
	 * @param   toExec  an array of execute function parameters
	 */
	function executeMultiple(ExecuteArgs[] calldata toExec) external payable {
		for (uint256 i = 0; i != toExec.length; i++) execute(toExec[i].calls, toExec[i].signature);
	}

	/**
	 * @notice  Allows executing calls if the caller itself is authorized
	 * @dev     no need for nonce management here cause we're not dealing with sigs
	 * @param   calls  the transaction we're executing
	 */
	function executeBySender(Transaction[] calldata calls) external payable {
		require(privileges(msg.sender) != bytes32(0), 'INSUFFICIENT_PRIVILEGE');
		executeBatch(calls);
		// again, anti-bricking
		require(privileges(msg.sender) != bytes32(0), 'PRIVILEGE_NOT_DOWNGRADED');
	}

	/**
	 * @notice  allows the contract itself to execute a batch of calls
	 * self-calling is useful in cases like wanting to do multiple things in a tryCatchLimit
	 * @param   calls  the calls we're executing
	 */
	function executeBySelf(Transaction[] calldata calls) external payable {
		require(msg.sender == address(this), 'ONLY_ACCOUNT_CAN_CALL');
		executeBatch(calls);
	}

	/**
	 * @notice  allows the contract itself to execute a single calls
	 * self-calling is useful when you want to workaround the executeBatch()
	 * protection of not being able to call address(0)
	 * @param   call  the call we're executing
	 */
	function executeBySelfSingle(Transaction calldata call) external payable {
		require(msg.sender == address(this), 'ONLY_ACCOUNT_CAN_CALL');
		executeCall(call.to, call.value, call.data);
	}

	/**
	 * @notice  Execute a batch of transactions
	 * @param   calls  the transaction we're executing
	 */
	function executeBatch(Transaction[] memory calls) internal {
		uint256 len = calls.length;
		for (uint256 i = 0; i < len; i++) {
			Transaction memory call = calls[i];
			if (call.to != address(0)) executeCall(call.to, call.value, call.data);
		}
	}

	/**
	 * @notice  Execute a signle transaction
	 * @dev     we shouldn't use address.call(), cause: https://github.com/ethereum/solidity/issues/2884
	 * @param   to  the address we're sending to
	 * @param   value  the amount we're sending
	 * @param   data  callData
	 */
	function executeCall(address to, uint256 value, bytes memory data) internal {
		assembly {
			let result := call(gas(), to, value, add(data, 0x20), mload(data), 0, 0)

			if eq(result, 0) {
				let size := returndatasize()
				let ptr := mload(0x40)
				returndatacopy(ptr, 0, size)
				revert(ptr, size)
			}
		}
	}

	/**
	 * @notice  EIP-1271 implementation
	 * @dev     see https://eips.ethereum.org/EIPS/eip-1271
	 * @param   hash  the signed hash
	 * @param   signature  the signature for the signed hash
	 * @return  bytes4  is it a success or a failure
	 */
	function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
		(address recovered, bool usedUnprotected) = SignatureValidator.recoverAddrAllowUnprotected(hash, signature, false);
		if (uint256(privileges(recovered)) > (usedUnprotected ? 1 : 0)) {
			// bytes4(keccak256("isValidSignature(bytes32,bytes)")
			return 0x1626ba7e;
		} else {
			return 0xffffffff;
		}
	}

	/**
	 * @notice  EIP-1155 implementation
	 * we pretty much only need to signal that we support the interface for 165, but for 1155 we also need the fallback function
	 * @param   interfaceID  the interface we're signaling support for
	 * @return  bool  do we support the interface or not
	 */
	function supportsInterface(bytes4 interfaceID) external pure returns (bool) {
		bool supported = interfaceID == 0x01ffc9a7 || // ERC-165 support (i.e. `bytes4(keccak256('supportsInterface(bytes4)'))`).
			interfaceID == 0x150b7a02 || // ERC721TokenReceiver
			interfaceID == 0x4e2312e0 || // ERC-1155 `ERC1155TokenReceiver` support (i.e. `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)")) ^ bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))`).
			interfaceID == 0x0a417632; // used for checking whether the account is v2 or not
		return supported;
	}

	//
	// EIP-4337 implementation
	//
	// return value in case of signature failure, with no time-range.
	// equivalent to packSigTimeRange(true,0,0);
	uint256 constant internal SIG_VALIDATION_FAILED = 1;
	// equivalent to packSigTimeRange(false,0,0);
	uint256 constant internal SIG_VALIDATION_SUCCESS = 0;

	/**
	 * @notice  EIP-4337 implementation
	 * @dev     We have an edge case for enabling ERC-4337 in the first if statement.
	 * If the function call is to execute, we do not perform an userOp sig validation.
	 * We require a one time hash nonce commitment from the paymaster for the given
	 * req. We use this to give permissions to the entry point on the fly
	 * and enable ERC-4337
	 * @param   op  the PackedUserOperation we're executing
	 * @param   userOpHash  the hash we've committed to
	 * @param   missingAccountFunds  the funds the account needs to pay
	 * @return  uint256  0 for success, 1 for signature failure, and a uint256
	 * packed timestamp for a future valid signature:
	 * address aggregator, uint48 validUntil, uint48 validAfter
	 */
	function validateUserOp(PackedUserOperation calldata op, bytes32 userOpHash, uint256 missingAccountFunds)
	external payable returns (uint256)
	{
		require(privileges(msg.sender) == ENTRY_POINT_MARKER, 'validateUserOp: not from entryPoint');

		// @estimation
		// paying should happen even if signature validation fails
		if (missingAccountFunds > 0) {
			// NOTE: MAY pay more than the minimum, to deposit for future transactions
			(bool success,) = msg.sender.call{value : missingAccountFunds}('');
			// ignore failure (its EntryPoint's job to verify, not account.)
			(success);
		}

		// this is replay-safe because userOpHash is retrieved like this: keccak256(abi.encode(userOp.hash(), address(this), block.chainid))
		(address signer, ) = SignatureValidator.recoverAddrAllowUnprotected(
			Eip712HashBuilder.getUserOp712Hash(op, userOpHash),
			op.signature,
			true
		);
		if (privileges(signer) == bytes32(0)) return SIG_VALIDATION_FAILED;

		return SIG_VALIDATION_SUCCESS;
	}

	function validateExternalSig(Transaction[] memory calls, bytes calldata signature)
	internal returns(address signerKey, bool isValidSig, uint256 timestampValidAfter) {
		(bytes memory sig, ) = SignatureValidator.splitSignature(signature);
		// the address of the validator we're using for this validation
		address validatorAddr;
		// all the data needed by the validator to execute the validation.
		// In the case of DKIMRecoverySigValidator, this is AccInfo:
		// abi.encode {string emailFrom; string emailTo; string domainName;
		// bytes dkimPubKeyModulus; bytes dkimPubKeyExponent; address secondaryKey;
		// bool acceptUnknownSelectors; uint32 waitUntilAcceptAdded;
		// uint32 waitUntilAcceptRemoved; bool acceptEmptyDKIMSig;
		// bool acceptEmptySecondSig;uint32 onlyOneSigTimelock;}
		// The struct is declared in DKIMRecoverySigValidator
		bytes memory validatorData;
		// the signature data needed by the external validator.
		// In the case of DKIMRecoverySigValidator, this is abi.encode(
		// SignatureMeta memory sigMeta, bytes memory dkimSig, bytes memory secondSig
		// ).
		bytes memory innerSig;
		// the signerKey in this case is an arbitrary value that does
		// not have any specific purpose other than representing
		// the privileges key
		(signerKey, validatorAddr, validatorData, innerSig) = abi.decode(sig, (address, address, bytes, bytes));
		require(
			privileges(signerKey) == keccak256(abi.encode(validatorAddr, validatorData)),
			'EXTERNAL_VALIDATION_NOT_SET'
		);

		// The sig validator itself should throw when a signature isn't validated successfully
		// the return value just indicates whether we want to execute the current calls
		(isValidSig, timestampValidAfter) = ExternalSigValidator(validatorAddr).validateSig(validatorData, innerSig, calls);
	}
}
