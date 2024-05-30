// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './deployless/IAmbireAccount.sol';
import './libs/Transaction.sol';

/**
 * @notice  A contract used for deploying AmbireAccount.sol
 * @dev     We use create2 to get the AmbireAccount address. It's deterministic:
 * if the same data is passed to it, the same address will pop out.
 */
contract AmbireFactory {
	event LogDeployed(address addr, uint256 salt);

	address public immutable allowedToDrain;

	constructor(address allowed) {
		allowedToDrain = allowed;
	}

	/**
	 * @notice  Allows anyone to deploy any contracft with a specific code/salt
	 * @dev     This is safe because it's CREATE2 deployment
	 * @param   code  the code to be deployed
	 * @param   salt  the salt to shuffle the computed address
	 * @return  address  the deployed address
	 */
	function deploy(bytes calldata code, uint256 salt) external returns(address) {
		return deploySafe(code, salt);
	}

	
	/**
	 * @notice  Call this when you want to deploy the contract and execute calls
	 * @dev     When the relayer needs to act upon an /identity/:addr/submit call, it'll either call execute on the AmbireAccount directly
	 * if it's already deployed, or call `deployAndExecute` if the account is still counterfactual
	 * we can't have deployAndExecuteBySender, because the sender will be the factory
	 * @param   code  the code to be deployed
	 * @param   salt  the salt to shuffle the computed address
	 * @param   txns  the txns the are going to be executed
	 * @param   signature  the signature for the txns
	 * @return  address  the deployed address
	 */
	function deployAndExecute(
		bytes calldata code,
		uint256 salt,
		Transaction[] calldata txns,
		bytes calldata signature
	) external returns (address){
		address payable addr = payable(deploySafe(code, salt));
		IAmbireAccount(addr).execute(txns, signature);
		return addr;
	}

	
	/**
	 * @notice  Call this when you want to deploy the contract and call executeMultiple
	 * @dev     when the relayer needs to act upon an /identity/:addr/submit call, 
	 * it'll either call execute on the AmbireAccount directly. If it's already
	 * deployed, or call `deployAndExecuteMultiple` if the account is still
	 * counterfactual but there are multiple accountOps to send
	 * @param   code  the code to be deployed
	 * @param   salt  the salt to shuffle the computed address
	 * @param   toExec  [txns, signature] execute parameters
	 * @return  address  the deployed address
	 */
	function deployAndExecuteMultiple(
		bytes calldata code,
		uint256 salt,
		IAmbireAccount.ExecuteArgs[] calldata toExec
	) external returns (address){
		address payable addr = payable(deploySafe(code, salt));
		IAmbireAccount(addr).executeMultiple(toExec);
		return addr;
	}

	/**
	 * @notice  This method can be used to withdraw stuck tokens or airdrops
	 * @dev     Only allowedToDrain can do the call
	 * @param   to  receiver
	 * @param   value  how much to be sent
	 * @param   data  if a token has airdropped, code to send it
	 * @param   gas  maximum gas willing to spend
	 */
	function call(address to, uint256 value, bytes calldata data, uint256 gas) external {
		require(msg.sender == allowedToDrain, 'ONLY_AUTHORIZED');
		(bool success, bytes memory err) = to.call{ gas: gas, value: value }(data);
		require(success, string(err));
	}
	
	/**
	 * @dev     This is done to mitigate possible frontruns where, for example,
	 * where deploying the same code/salt via deploy() would make a pending
	 * deployAndExecute fail. The way we mitigate that is by checking if the
	 * contract is already deployed and if so, we continue execution
	 * @param   code  the code to be deployed
	 * @param   salt  the salt to shuffle the computed address
	 * @return  address  the deployed address
	 */
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
