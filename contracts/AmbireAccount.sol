// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './libs/SignatureValidator.sol';
import './ExternalSigValidator.sol';
import './libs/erc4337/UserOperation.sol';

/**
 * @notice  A validator that performs DKIM signature recovery
 * @dev     All external/public functions (that are not view/pure) use `payable` because AmbireAccount
 * is a wallet contract, and any ETH sent to it is not lost, but on the other hand not having `payable`
 * makes the Solidity compiler add an extra check for `msg.value`, which in this case is wasted gas
 */
contract AmbireAccount {
	// @dev We do not have a constructor. This contract cannot be initialized with any valid `privileges` by itself!
	// The intended use case is to deploy one base implementation contract, and create a minimal proxy for each user wallet, by
	// using our own code generation to insert SSTOREs to initialize `privileges` (IdentityProxyDeploy.js)
	address private constant FALLBACK_HANDLER_SLOT = address(0x6969);

	// @dev This is how we understand if msg.sender is the entry point
	address private constant ENTRY_POINT_MARKER = address(0x7171);

	// Externally validated signatures
	uint8 private constant SIGMODE_EXTERNALLY_VALIDATED = 255;

	// Variables
	mapping(address => bytes32) public privileges;
	uint256 public nonce;

	// Events
	event LogPrivilegeChanged(address indexed addr, bytes32 priv);
	event LogErr(address indexed to, uint256 value, bytes data, bytes returnData); // only used in tryCatch

	// built-in batching of multiple execute()'s; useful when performing timelocked recoveries
	struct ExecuteArgs {
		Transaction[] calls;
		bytes signature;
	}

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
	 * @notice  fallback method: currently used to call the fallback handler
	 * which is set by the user and can be changed
	 * @dev     this contract can accept ETH with calldata, hence payable
	 */
	fallback() external payable {
		// We store the fallback handler at this magic slot
		address fallbackHandler = address(uint160(uint(privileges[FALLBACK_HANDLER_SLOT])));
		if (fallbackHandler == address(0)) return;
		assembly {
			// we can use addr 0 because logic is taking full control of the
			// execution making sure it returns itself and does not
			// rely on any further Solidity code.
			calldatacopy(0, 0, calldatasize())
			let result := delegatecall(gas(), fallbackHandler, 0, calldatasize(), 0, 0)
			let size := returndatasize()
			returndatacopy(0, 0, size)
			if eq(result, 0) {
				revert(0, size)
			}
			return(0, size)
		}
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
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		privileges[addr] = priv;
		emit LogPrivilegeChanged(addr, priv);
	}

	/**
	 * @notice  Useful when we need to do multiple operations but ignore failures in some of them
	 * @param   to  address we're sending value to
	 * @param   value  the amount
	 * @param   data  callData
	 */
	function tryCatch(address to, uint256 value, bytes calldata data) external payable {
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
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
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
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
		uint256 currentNonce = nonce;
		// we increment the nonce here (not using `nonce++` to save some gas)
		// in case shouldExecute is false, we revert it back
		nonce = currentNonce + 1;

		if (sigMode == SIGMODE_EXTERNALLY_VALIDATED) {
			bool isValidSig;
			uint256 timestampValidAfter;
			(signerKey, isValidSig, timestampValidAfter) = validateExternalSig(calls, signature);
			if (!isValidSig) {
				require(block.timestamp >= timestampValidAfter, 'SIGNATURE_VALIDATION_TIMELOCK');
				revert('SIGNATURE_VALIDATION_FAIL');
			}
		} else {
			signerKey = SignatureValidator.recoverAddrImpl(
				keccak256(abi.encode(address(this), block.chainid, currentNonce, calls)),
				signature,
				true
			);
			require(privileges[signerKey] != bytes32(0), 'INSUFFICIENT_PRIVILEGE');
		}

		executeBatch(calls);

		// The actual anti-bricking mechanism - do not allow a signerKey to drop their own privileges
		require(privileges[signerKey] != bytes32(0), 'PRIVILEGE_NOT_DOWNGRADED');
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
		require(privileges[msg.sender] != bytes32(0), 'INSUFFICIENT_PRIVILEGE');
		executeBatch(calls);
		// again, anti-bricking
		require(privileges[msg.sender] != bytes32(0), 'PRIVILEGE_NOT_DOWNGRADED');
	}

	/**
	 * @notice  allows the contract itself to execute a batch of calls
	 * self-calling is useful in cases like wanting to do multiple things in a tryCatchLimit
	 * @param   calls  the transaction we're executing
	 */
	function executeBySelf(Transaction[] calldata calls) external payable {
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		executeBatch(calls);
	}

	/**
	 * @notice  Execute a batch of transactions
	 * @param   calls  the transaction we're executing
	 */
	function executeBatch(Transaction[] memory calls) internal {
		uint256 len = calls.length;
		for (uint256 i = 0; i < len; i++) {
			Transaction memory call = calls[i];
			executeCall(call.to, call.value, call.data);
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
		// We enforce this one additional step in preparing `hash`, to avoid the sig being valid across multiple accounts
		// in case the hash preimage doesn't include the account address
		hash = keccak256(abi.encode(hash, address(this)));
		if (privileges[SignatureValidator.recoverAddr(hash, signature)] != bytes32(0)) {
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
	function supportsInterface(bytes4 interfaceID) external view returns (bool) {
		bool supported = interfaceID == 0x01ffc9a7 || // ERC-165 support (i.e. `bytes4(keccak256('supportsInterface(bytes4)'))`).
			interfaceID == 0x150b7a02 || // ERC721TokenReceiver
			interfaceID == 0x4e2312e0 || // ERC-1155 `ERC1155TokenReceiver` support (i.e. `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)")) ^ bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))`).
			interfaceID == 0x0a417632; // used for checking whether the account is v2 or not
		if (supported) return true;
		address payable fallbackHandler = payable(address(uint160(uint256(privileges[FALLBACK_HANDLER_SLOT]))));
		if (fallbackHandler == address(0)) return false;
		return AmbireAccount(fallbackHandler).supportsInterface(interfaceID);
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
	 * @param   op  the UserOperation we're executing
	 * @param   userOpHash  the hash we've committed to
	 * @param   missingAccountFunds  the funds the account needs to pay
	 * @return  uint256  0 for success, 1 for signature failure, and a uint256
	 * packed timestamp for a future valid signature:
	 * address aggregator, uint48 validUntil, uint48 validAfter
	 */
	function validateUserOp(UserOperation calldata op, bytes32 userOpHash, uint256 missingAccountFunds)
	external payable returns (uint256)
	{
		// enable running executeMultiple operation through the entryPoint if
		// a paymaster sponsors it with a commitment one-time nonce.
		// two use cases:
		// 1) enable 4337 on a network by giving priviledges to the entryPoint
		// 2) key recovery. If the key is lost, we cannot sign the userOp,
		// so we have to go to `execute` to trigger the recovery logic
		// Why executeMultiple but not execute?
		// executeMultiple allows us to combine recovery + fee payment calls.
		// The fee payment call will be with a signature from the new key
		if (op.callData.length >= 4 && bytes4(op.callData[0:4]) == this.executeMultiple.selector) {
			// Require a paymaster, otherwise this mode can be used by anyone to get the user to spend their deposit
			require(op.signature.length == 0, 'validateUserOp: empty signature required in execute() mode');
			require(op.paymasterAndData.length >= 20, 'validateUserOp: paymaster required in execute() mode');
			// hashing in everything except sender (nonces are scoped by sender anyway), nonce, signature
			uint256 targetNonce = uint256(keccak256(
				abi.encode(op.initCode, op.callData, op.callGasLimit, op.verificationGasLimit, op.preVerificationGas, op.maxFeePerGas, op.maxPriorityFeePerGas, op.paymasterAndData)
			)) << 64;
			require(op.nonce == targetNonce, 'validateUserOp: execute(): one-time nonce is wrong');
			return SIG_VALIDATION_SUCCESS;
		}

		require(address(uint160(uint256(privileges[msg.sender]))) == ENTRY_POINT_MARKER, 'validateUserOp: not from entryPoint');

		// this is replay-safe because userOpHash is retrieved like this: keccak256(abi.encode(userOp.hash(), address(this), block.chainid))
		address signer = SignatureValidator.recoverAddr(userOpHash, op.signature);
		if (privileges[signer] == bytes32(0)) return SIG_VALIDATION_FAILED;

		// NOTE: we do not have to pay the entryPoint if SIG_VALIDATION_FAILED, so we just return on those
		if (missingAccountFunds > 0) {
			// NOTE: MAY pay more than the minimum, to deposit for future transactions
			(bool success,) = payable(msg.sender).call{value : missingAccountFunds}('');
			// ignore failure (its EntryPoint's job to verify, not account.)
			(success);
		}

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
			privileges[signerKey] == keccak256(abi.encode(validatorAddr, validatorData)),
			'EXTERNAL_VALIDATION_NOT_SET'
		);

		// The sig validator itself should throw when a signature isn't validated successfully
		// the return value just indicates whether we want to execute the current calls
		(isValidSig, timestampValidAfter) = ExternalSigValidator(validatorAddr).validateSig(validatorData, innerSig, calls);
	}
}
