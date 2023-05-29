// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './AmbireAccount.sol';

contract AmbireAccountFactory {
	event LogDeployed(address addr, uint256 salt);

	address public immutable allowedToDrain;

	constructor(address allowed) {
		allowedToDrain = allowed;
	}

	// @notice allows anyone to deploy any contracft with a specific code/salt
	// this is safe because it's CREATE2 deployment
	function deploy(bytes calldata code, uint256 salt) external {
		deploySafe(code, salt);
	}

	// @notice when the relayer needs to act upon an /identity/:addr/submit call, it'll either call execute on the AmbireAccount directly
	// if it's already deployed, or call `deployAndExecute` if the account is still counterfactual
	// we can't have deployAndExecuteBySender, because the sender will be the factory
	function deployAndExecute(
		bytes calldata code,
		uint256 salt,
		AmbireAccount.Transaction[] calldata txns,
		bytes calldata signature
	) external {
		address payable addr = payable(deploySafe(code, salt));
		AmbireAccount(addr).execute(txns, signature);
	}

	// @notice This method can be used to withdraw stuck tokens or airdrops
	function call(address to, uint256 value, bytes calldata data, uint256 gas) external {
		require(msg.sender == allowedToDrain, 'ONLY_AUTHORIZED');
		(bool success, bytes memory err) = to.call{ gas: gas, value: value }(data);
		require(success, string(err));
	}

	// @dev This is done to mitigate possible frontruns where, for example, deploying the same code/salt via deploy()
	// would make a pending deployAndExecute fail
	// The way we mitigate that is by checking if the contract is already deployed and if so, we continue execution
	function deploySafe(bytes memory code, uint256 salt) internal returns (address) {
		address expectedAddr = address(
			uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code)))))
		);
		uint256 size;
		assembly {
			size := extcodesize(expectedAddr)
		}
		// If there is code at that address, we can assume it's the one we were about to deploy,
		// because of how CREATE2 and keccak256 works
		if (size == 0) {
			address addr;
			assembly {
				addr := create2(0, add(code, 0x20), mload(code), salt)
			}
			require(addr != address(0), 'FAILED_DEPLOYING');
			require(addr == expectedAddr, 'FAILED_MATCH');
			emit LogDeployed(addr, salt);
		}
		return expectedAddr;
	}
}
