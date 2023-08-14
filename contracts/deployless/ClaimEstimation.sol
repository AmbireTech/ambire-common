// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "./IAmbireAccount.sol";

interface IERC20Subset {
  function balanceOf(address account) external view returns (uint256);
  function transfer(address recipient, uint256 amount) external returns (bool);
}

interface IStakingPool {
	function enterTo(address recipient, uint amount) external;
}

interface ISupplyController {
  function mintVesting(
    address recipient,
    uint end,
    uint amountPerSecond
  ) external;
  function claimWithRootUpdate(
    uint totalRewardInTree,
    bytes32[] calldata proof,
    uint toBurnBps,
    IStakingPool stakingPool,
    bytes32 newRoot,
    bytes calldata signature
  ) external;
}


contract ClaimEstimation {
    struct EstimationOutcome {
        uint256 xWalletAmount;
        uint256 walletAmount;
    }
 
    struct VestingData {
        address recipient;
        uint end;
        uint amountPerSecond;
    }

    struct RewardsData {
        uint totalRewardInTree;
        bytes32[] proof;
        uint toBurnBps;
        IStakingPool stakingPool;
        bytes32 newRoot;
        bytes signature;
    }

    function estimate(
        address supplyControllerAddr,
        address walletERC20Addr,
        address xWalletERC20Addr,
        address identityAddr,
        VestingData calldata vestingData,
        RewardsData calldata rewardsData
    ) external returns (EstimationOutcome memory outcome) {
        uint256 walletAmount = IERC20Subset(walletERC20Addr).balanceOf(identityAddr);
        uint256 xWalletAmount = IERC20Subset(xWalletERC20Addr).balanceOf(identityAddr);

        if (vestingData.recipient != address(0)){
            ISupplyController(supplyControllerAddr).mintVesting(vestingData.recipient, vestingData.end, vestingData.amountPerSecond);
            outcome.walletAmount = IERC20Subset(walletERC20Addr).balanceOf(identityAddr) - walletAmount;
        }

        ISupplyController(supplyControllerAddr).claimWithRootUpdate(
            rewardsData.totalRewardInTree,
            rewardsData.proof,
            rewardsData.toBurnBps,
            rewardsData.stakingPool,
            rewardsData.newRoot,
            rewardsData.signature
        );
        outcome.xWalletAmount = IERC20Subset(xWalletERC20Addr).balanceOf(identityAddr) - xWalletAmount;
        
        return outcome;
    }
    
}