// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './libs/SignatureValidator.sol';
import './ExternalSigValidator.sol';

// EIP-4337 UserOperation
// https://eips.ethereum.org/EIPS/eip-4337#required-entry-point-contract-functionality
struct UserOperation {
	address sender;
	uint256 nonce;
	bytes initCode;
	bytes callData;
	uint256 callGasLimit;
	uint256 verificationGasLimit;
	uint256 preVerificationGas;
	uint256 maxFeePerGas;
	uint256 maxPriorityFeePerGas;
	bytes paymasterAndData;
	bytes signature;
}

interface NonceManager {
	function getNonce(address sender, uint192 key) external view returns (uint256 nonce);
}

// @dev All external/public functions (that are not view/pure) use `payable` because AmbireAccount
// is a wallet contract, and any ETH sent to it is not lost, but on the other hand not having `payable`
// makes the Solidity compiler add an extra check for `msg.value`, which in this case is wasted gas
contract AmbireAccount {
	// @dev We do not have a constructor. This contract cannot be initialized with any valid `privileges` by itself!
	// The intended use case is to deploy one base implementation contract, and create a minimal proxy for each user wallet, by
	// using our own code generation to insert SSTOREs to initialize `privileges` (IdentityProxyDeploy.js)
	address private constant FALLBACK_HANDLER_SLOT = address(0x6969);

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

	// To support EIP 721 and EIP 1155, we need to respond to those methods with their own method signature
	function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
		return this.onERC721Received.selector;
	}

	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return this.onERC1155Received.selector;
	}

	function onERC1155BatchReceived(
		address,
		address,
		uint256[] calldata,
		uint256[] calldata,
		bytes calldata
	) external pure returns (bytes4) {
		return this.onERC1155BatchReceived.selector;
	}

	// @notice fallback method: currently used to call the fallback handler
	// which is set by the user and can be changed
	// @dev this contract can accept ETH with calldata, hence payable
	fallback() external payable {
		// We store the fallback handler at this magic slot
		address fallbackHandler = address(uint160(uint(privileges[FALLBACK_HANDLER_SLOT])));
		if (fallbackHandler == address(0)) return;
		assembly {
			// We can use memory addr 0, since it's not occupied
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

	// @notice used to set the privilege of a key (by `addr`); normal signatures will be considered valid if the
	// `addr` they are signed with has non-zero (not 0x000..000) privilege set; we can set the privilege to
	// a hash of the recovery keys and timelock (see `RecoveryInfo`) to enable recovery signatures
	function setAddrPrivilege(address addr, bytes32 priv) external payable {
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		privileges[addr] = priv;
		emit LogPrivilegeChanged(addr, priv);
	}

	// @notice Useful when we need to do multiple operations but ignore failures in some of them
	function tryCatch(address to, uint256 value, bytes calldata data) external payable {
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		uint256 gasBefore = gasleft();
		(bool success, bytes memory returnData) = to.call{ value: value, gas: gasBefore }(data);
		require(gasleft() > gasBefore / 64, 'TRYCATCH_OOG');
		if (!success) emit LogErr(to, value, data, returnData);
	}

	// @notice same as `tryCatch` but with a gas limit
	function tryCatchLimit(address to, uint256 value, bytes calldata data, uint256 gasLimit) external payable {
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		uint256 gasBefore = gasleft();
		(bool success, bytes memory returnData) = to.call{ value: value, gas: gasLimit }(data);
		require(gasleft() > gasBefore / 64, 'TRYCATCH_OOG');
		if (!success) emit LogErr(to, value, data, returnData);
	}

	// @notice execute: this method is used to execute a single bundle of calls that are signed with a key
	// that is authorized to execute on this account (in `privileges`)
	// @dev: WARNING: if the signature of this is changed, we have to change AmbireAccountFactory
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

	// @notice allows executing multiple bundles of calls (batch together multiple executes)
	function executeMultiple(ExecuteArgs[] calldata toExec) external payable {
		for (uint256 i = 0; i != toExec.length; i++) execute(toExec[i].calls, toExec[i].signature);
	}

	// @notice Allows executing calls if the caller itself is authorized
	// @dev no need for nonce management here cause we're not dealing with sigs
	function executeBySender(Transaction[] calldata calls) external payable {
		require(privileges[msg.sender] != bytes32(0), 'INSUFFICIENT_PRIVILEGE');
		executeBatch(calls);
		// again, anti-bricking
		require(privileges[msg.sender] != bytes32(0), 'PRIVILEGE_NOT_DOWNGRADED');
	}

	// @notice allows the contract itself to execute a batch of calls
	// self-calling is useful in cases like wanting to do multiple things in a tryCatchLimit
	function executeBySelf(Transaction[] calldata calls) external payable {
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		executeBatch(calls);
	}

	function executeBatch(Transaction[] memory calls) internal {
		uint256 len = calls.length;
		for (uint256 i = 0; i < len; i++) {
			Transaction memory call = calls[i];
			executeCall(call.to, call.value, call.data);
		}
	}

	// we shouldn't use address.call(), cause: https://github.com/ethereum/solidity/issues/2884
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

	// @notice EIP-1271 implementation
	// see https://eips.ethereum.org/EIPS/eip-1271
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

	// @notice EIP-1155 implementation
	// we pretty much only need to signal that we support the interface for 165, but for 1155 we also need the fallback function
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

	function validateUserOp(UserOperation calldata op, bytes32 userOpHash, uint256 missingAccountFunds)
	external returns (uint256)
	{
		if (op.signature.length == 0 && bytes4(op.callData[0:4]) == this.execute.selector) {
			// Require a paymaster, otherwise this mode can be used by anyone to get the user to spend their deposit
			require(op.paymasterAndData.length >= 20, 'validateUserOp: paymaster required in execute() mode');
			// hashing in everything except sender (nonces are scoped by sender anyway), nonce, signature
			uint256 targetNonce = uint256(uint192(uint256(keccak256(
				abi.encode(op.initCode, op.callData, op.callGasLimit, op.verificationGasLimit, op.preVerificationGas, op.maxFeePerGas, op.maxPriorityFeePerGas, op.paymasterAndData)
			))) << 64);
			require(op.nonce == targetNonce, 'validateUserOp: execute(): one-time nonce is wrong');
			return 0;
		}
		require(address(uint160(uint256(privileges[msg.sender]))) == ENTRY_POINT_MARKER, 'validateUserOp: not from entryPoint');
		uint8 sigMode = uint8(op.signature[op.signature.length - 1]);
		if (sigMode == SIGMODE_EXTERNALLY_VALIDATED) {
			// 68: two words + 4 for the sighash
			require(op.callData.length >= 68 && bytes4(op.callData[0:4]) == this.executeBySender.selector, 'validateUserOp: needs to call executeBySender');
			Transaction[] memory calls = abi.decode(op.callData[4:], (Transaction[]));

			(, bool isValidSig, uint256 timestampValidAfter) = validateExternalSig(calls, op.signature);
			if (!isValidSig) return SIG_VALIDATION_FAILED;
			// pack the return value for validateUserOp
			// address aggregator, uint48 validUntil, uint48 validAfter
			if (timestampValidAfter != 0) {
				return uint160(0) | (uint256(0) << 160) | (uint256(timestampValidAfter) << (208));
			}
		} else {
			// this is replay-safe because userOpHash is retrieved like this: keccak256(abi.encode(userOp.hash(), address(this), block.chainid))
			address signer = SignatureValidator.recoverAddr(userOpHash, op.signature);
			if (privileges[signer] == bytes32(0)) return SIG_VALIDATION_FAILED;
		}

		// NOTE: we do not have to pay th entryPoint if SIG_VALIDATION_FAILED, so we just return on those
		if (missingAccountFunds > 0) {
			// NOTE: MAY pay more than the minimum, to deposit for future transactions
			(bool success,) = payable(msg.sender).call{value : missingAccountFunds}('');
			// ignore failure (its EntryPoint's job to verify, not account.)
			(success);
		}

		return 0;
	}

	function validateExternalSig(Transaction[] memory calls, bytes calldata signature)
	internal returns(address signerKey, bool isValidSig, uint256 timestampValidAfter) {
		(bytes memory sig, ) = SignatureValidator.splitSignature(signature);
		address validatorAddr;
		bytes memory validatorData;
		bytes memory innerSig;
		(signerKey, validatorAddr, validatorData, innerSig) = abi.decode(sig, (address, address, bytes, bytes));
		require(
			privileges[signerKey] == keccak256(abi.encode(validatorAddr, validatorData)),
			'EXTERNAL_VALIDATION_NOT_SET'
		);

		// The sig validator itself should throw when a signature isn't valdiated successfully
		// the return value just indicates whether we want to execute the current calls
		// @TODO what about reentrancy for externally validated signatures
		(isValidSig, timestampValidAfter) = ExternalSigValidator(validatorAddr).validateSig(address(this), validatorData, innerSig, calls);
	}
}
