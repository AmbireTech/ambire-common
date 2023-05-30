// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './libs/SignatureValidator.sol';

// @dev All external/public functions (that are not view/pure) use `payable` because AmbireAccount
// is a wallet contract, and any ETH sent to it is not lost, but on the other hand not having `payable`
// makes the Solidity compiler add an extra check for `msg.value`, which in this case is wasted gas
contract AmbireAccount {
	// @dev We do not have a constructor. This contract cannot be initialized with any valid `privileges` by itself!
	// The indended use case is to deploy one base implementation contract, and create a minimal proxy for each user wallet, by
	// using our own code generation to insert SSTOREs to initialize `privileges` (IdentityProxyDeploy.js)
	address private constant FALLBACK_HANDLER_SLOT = address(0x6969);

	// Variables
	mapping(address => bytes32) public privileges;
	uint256 public nonce;
	mapping(bytes32 => uint) public scheduledRecoveries;

	// Events
	event LogPrivilegeChanged(address indexed addr, bytes32 priv);
	event LogErr(address indexed to, uint256 value, bytes data, bytes returnData); // only used in tryCatch
	event LogRecoveryScheduled(
		bytes32 indexed txnHash,
		bytes32 indexed recoveryHash,
		address indexed recoveryKey,
		uint256 nonce,
		uint256 time,
		Transaction[] txns
	);
	event LogRecoveryCancelled(
		bytes32 indexed txnHash,
		bytes32 indexed recoveryHash,
		address indexed recoveryKey,
		uint256 time
	);
	event LogRecoveryFinalized(bytes32 indexed txnHash, bytes32 indexed recoveryHash, uint256 time);

	// Transaction structure
	// we handle replay protection separately by requiring (address(this), chainID, nonce) as part of the sig
	// @dev a better name for this would be `Call`, but we are keeping `Transaction` for backwards compatibility
	struct Transaction {
		address to;
		uint256 value;
		bytes data;
	}
	struct RecoveryInfo {
		address[] keys;
		uint256 timelock;
	}
	// built-in batching of multiple execute()'s; useful when performing timelocked recoveries
	struct ExecuteArgs {
		Transaction[] txns;
		bytes signature;
	}

	// Recovery mode constants
	uint8 private constant SIGMODE_CANCEL = 254;
	uint8 private constant SIGMODE_RECOVER = 255;

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
		(bool success, bytes memory returnData) = to.call{ value: value, gas: gasleft() }(data);
		if (!success) emit LogErr(to, value, data, returnData);
	}

	// @notice same as `tryCatch` but with a gas limit
	function tryCatchLimit(address to, uint256 value, bytes calldata data, uint256 gasLimit) external payable {
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		(bool success, bytes memory returnData) = to.call{ value: value, gas: gasLimit }(data);
		if (!success) emit LogErr(to, value, data, returnData);
	}

	// @notice execute: this method is used to execute a single bundle of calls that are signed with a key
	// that is authorized to execute on this account (in `privileges`)
	// @dev: WARNING: if the signature of this is changed, we have to change AmbireAccountFactory
	function execute(Transaction[] calldata txns, bytes calldata signature) public payable {
		uint256 currentNonce = nonce;
		// NOTE: abi.encode is safer than abi.encodePacked in terms of collision safety
		bytes32 hash = keccak256(abi.encode(address(this), block.chainid, currentNonce, txns));

		address signerKey;
		// Recovery signature: allows to perform timelocked txns
		uint8 sigMode = uint8(signature[signature.length - 1]);

		if (sigMode == SIGMODE_RECOVER || sigMode == SIGMODE_CANCEL) {
			(bytes memory sig, ) = SignatureValidator.splitSignature(signature);
			(RecoveryInfo memory recoveryInfo, bytes memory innerRecoverySig, address signerKeyToRecover) = abi.decode(
				sig,
				(RecoveryInfo, bytes, address)
			);
			signerKey = signerKeyToRecover;
			bool isCancellation = sigMode == SIGMODE_CANCEL;
			bytes32 recoveryInfoHash = keccak256(abi.encode(recoveryInfo));
			require(privileges[signerKeyToRecover] == recoveryInfoHash, 'RECOVERY_NOT_AUTHORIZED');

			uint256 scheduled = scheduledRecoveries[hash];
			if (scheduled != 0 && !isCancellation) {
				require(block.timestamp > scheduled, 'RECOVERY_NOT_READY');
				nonce++;
				delete scheduledRecoveries[hash];
				emit LogRecoveryFinalized(hash, recoveryInfoHash, block.timestamp);
			} else {
				bytes32 hashToSign = isCancellation ? keccak256(abi.encode(hash, 0x63616E63)) : hash;
				address recoveryKey = SignatureValidator.recoverAddrImpl(hashToSign, innerRecoverySig, true);
				bool isIn;
				for (uint256 i = 0; i < recoveryInfo.keys.length; i++) {
					if (recoveryInfo.keys[i] == recoveryKey) {
						isIn = true;
						break;
					}
				}
				require(isIn, 'RECOVERY_NOT_AUTHORIZED');
				if (isCancellation) {
					delete scheduledRecoveries[hash];
					emit LogRecoveryCancelled(hash, recoveryInfoHash, recoveryKey, block.timestamp);
				} else {
					scheduledRecoveries[hash] = block.timestamp + recoveryInfo.timelock;
					emit LogRecoveryScheduled(hash, recoveryInfoHash, recoveryKey, currentNonce, block.timestamp, txns);
				}
				return;
			}
		} else {
			signerKey = SignatureValidator.recoverAddrImpl(hash, signature, true);
			require(privileges[signerKey] != bytes32(0), 'INSUFFICIENT_PRIVILEGE');
		}

		// we increment the nonce to prevent reentrancy
		// also, we do it here as we want to reuse the previous nonce
		// and respectively hash upon recovery / canceling
		// doing this after sig verification is fine because sig verification can only do STATICCALLS
		nonce = currentNonce + 1;
		executeBatch(txns);

		// The actual anti-bricking mechanism - do not allow a signerKey to drop their own privileges
		require(privileges[signerKey] != bytes32(0), 'PRIVILEGE_NOT_DOWNGRADED');
	}

	// @notice allows executing multiple bundles of calls (batch together multiple executes)
	function executeMultiple(ExecuteArgs[] calldata toExec) external payable {
		for (uint256 i = 0; i != toExec.length; i++) execute(toExec[i].txns, toExec[i].signature);
	}

	// @notice Allows executing calls if the caller itself is authorized
	// @dev no need for nonce management here cause we're not dealing with sigs
	function executeBySender(Transaction[] calldata txns) external payable {
		require(privileges[msg.sender] != bytes32(0), 'INSUFFICIENT_PRIVILEGE');
		executeBatch(txns);
		// again, anti-bricking
		require(privileges[msg.sender] != bytes32(0), 'PRIVILEGE_NOT_DOWNGRADED');
	}

	// @notice allows the contract itself to execute a batch of calls
	// self-calling is useful in cases like wanting to do multiple things in a tryCatchLimit
	function executeBySelf(Transaction[] calldata txns) external payable {
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		executeBatch(txns);
	}

	function executeBatch(Transaction[] memory txns) internal {
		uint256 len = txns.length;
		for (uint256 i = 0; i < len; i++) {
			Transaction memory txn = txns[i];
			executeCall(txn.to, txn.value, txn.data);
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
		if (privileges[SignatureValidator.recoverAddr(hash, signature)] != bytes32(0)) {
			// bytes4(keccak256("isValidSignature(bytes32,bytes)")
			return 0x1626ba7e;
		} else {
			return 0xffffffff;
		}
	}

	// @notice EIP-1155 implementation
	// we pretty much only need to signal that we support the interface for 165, but for 1155 we also need the fallback function
	function supportsInterface(bytes4 interfaceID) external pure returns (bool) {
		return
			interfaceID == 0x01ffc9a7 || // ERC-165 support (i.e. `bytes4(keccak256('supportsInterface(bytes4)'))`).
			interfaceID == 0x150b7a02 || // ERC721TokenReceiver
			interfaceID == 0x4e2312e0; // ERC-1155 `ERC1155TokenReceiver` support (i.e. `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)")) ^ bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))`).
	}
}
