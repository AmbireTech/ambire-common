// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.7;

contract NFTCheck {
	address private constant FALLBACK_HANDLER_SLOT = address(0x6969);

	// Variables
	mapping (address => bytes32) public privileges;
	uint public nonce;
	mapping (bytes32 => uint) public scheduledRecoveries;

	// Events
	event LogPrivilegeChanged(address indexed addr, bytes32 priv);
	event LogErr(address indexed to, uint value, bytes data, bytes returnData); // only used in tryCatch
	event LogRecoveryScheduled(bytes32 indexed txnHash, bytes32 indexed recoveryHash, address indexed recoveryKey, uint nonce, uint time, Transaction[] txns);
	event LogRecoveryCancelled(bytes32 indexed txnHash, bytes32 indexed recoveryHash, address indexed recoveryKey, uint time);
	event LogRecoveryFinalized(bytes32 indexed txnHash, bytes32 indexed recoveryHash, uint time);

	// Transaction structure
	// we handle replay protection separately by requiring (address(this), chainID, nonce) as part of the sig
	struct Transaction {
		address to;
		uint value;
		bytes data;
	}
	struct RecoveryInfo {
		address[] keys;
		uint timelock;
	}

	// Recovery mode constants
	uint8 private constant SIGMODE_RECOVER = 254;
	uint8 private constant SIGMODE_CANCEL = 255;

	constructor(address[] memory addrs) {
		uint len = addrs.length;
		for (uint i=0; i<len; i++) {
			// NOTE: privileges[] can be set to any arbitrary value, but for this we SSTORE directly through the proxy creator
			privileges[addrs[i]] = bytes32(uint(1));
			emit LogPrivilegeChanged(addrs[i], bytes32(uint(1)));
		}
	}

	// This contract can accept ETH without calldata
	receive() external payable {}

	// check if we have NFT support with this fallback
	fallback() external payable {
		bytes4 method = msg.sig;
		if (
			method == 0x150b7a02 // bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))
				|| method == 0xf23a6e61 // bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"))
				|| method == 0xbc197c81 // bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))
		) {
			// Copy back the method
			// solhint-disable-next-line no-inline-assembly
			assembly {
				calldatacopy(0, 0, 0x04)
				return (0, 0x20)
			}
		}
	}

	function setAddrPrivilege(address addr, bytes32 priv)
		external
	{
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		// Anti-bricking measure: if the privileges slot is used for special data (not 0x01),
		// don't allow to set it to true
		if (uint(privileges[addr]) > 1) require(priv != bytes32(uint(1)), 'UNSETTING_SPECIAL_DATA');
		privileges[addr] = priv;
		emit LogPrivilegeChanged(addr, priv);
	}

	// EIP 1155 implementation
	// we pretty much only need to signal that we support the interface for 165, but for 1155 we also need the fallback function
	function supportsInterface(bytes4 interfaceID) external pure returns (bool) {
		return
			interfaceID == 0x01ffc9a7 ||    // ERC-165 support (i.e. `bytes4(keccak256('supportsInterface(bytes4)'))`).
			interfaceID == 0x4e2312e0;      // ERC-1155 `ERC1155TokenReceiver` support (i.e. `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)")) ^ bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))`).
	}
}
