// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

import "./IERC20.sol";
import "./IAmbireAccount.sol";
import "./Simulation.sol";

contract BalanceGetter is Simulation {
    // Knowing the exact source of the error would be great, but we can always change this as this contract is meant to be called off-chain

    struct TokenInfo {
        string symbol;
        uint256 amount;
        uint8 decimals;
        bytes error;
    }
    struct BalancesAtNonce {
        TokenInfo[] balances;
        uint nonce;
    }

    function getERC20TokenInfo(IAmbireAccount account, IERC20 token) external view returns (TokenInfo memory info) {
	info.amount = token.balanceOf(address(account));
	info.symbol = token.symbol();
	info.decimals = token.decimals();
    }

    function getBalances(
        IAmbireAccount account,
        address[] calldata tokenAddrs
    ) public view returns (TokenInfo[] memory) {
        uint len = tokenAddrs.length;
        TokenInfo[] memory results = new TokenInfo[](len);
        for (uint256 i = 0; i < len; i++) {
            if (tokenAddrs[i] == address(0)) {
                results[i] = TokenInfo("ETH", address(account).balance, 18, bytes(""));
            } else {
		try this.getERC20TokenInfo(account, IERC20(tokenAddrs[i])) returns (TokenInfo memory info) {
			results[i] = info;
		} catch (bytes memory e) {
			results[i].error = e.length > 0 ? e : bytes("unkn");
		}
            }
	}
        return results;
    }

    function getBalancesWithInfo(IAmbireAccount account, address[] calldata tokenAddrs) public view returns (TokenInfo[] memory, uint, uint) {
        return (getBalances(account, tokenAddrs), gasleft(), block.number);
    }

    function simulateAndGetBalances(
        IAmbireAccount account,
        address[] calldata tokenAddrs,
        // instead of passing {factory, code, salt}, we'll just have factory and factoryCalldata
        address factory, bytes memory factoryCalldata,
        Simulation.ToSimulate[] calldata toSimulate
    ) external returns (
        BalancesAtNonce memory before, BalancesAtNonce memory afterSimulation,
        bytes memory/*simulationError*/,
        uint /*gasLeft*/, uint /*blockNum*/
    ) {
        before.balances = getBalances(account, tokenAddrs);

	    (uint startNonce, bool success, bytes memory err) = Simulation.simulate(account, factory, factoryCalldata, toSimulate);
	    before.nonce = startNonce;

        if (!success) {
            return (before, afterSimulation, err, gasleft(), block.number);
        }

        afterSimulation.nonce = account.nonce();
        if (afterSimulation.nonce != before.nonce) {
            afterSimulation.balances = getBalances(account, tokenAddrs);
        }

        return (before, afterSimulation, bytes(""), gasleft(), block.number);
    }
}
