// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "./IAmbireAccount.sol";

interface ISupplyController {
  function claimed(address) external returns (uint);
  function mintableVesting(address addr, uint end, uint amountPerSecond) external returns (uint);
  function vestingLastMint(address addr, uint end, uint amountPerSecond) external returns (uint);
}

contract ClaimableBalance {
  struct EstimationOutcome {
      uint256 rewardsAmount;
      uint256 vestingAmount;
      bool vestingEnded;
  }

  struct VestingData {
      address recipient;
      uint end;
      uint amountPerSecond;
  }

  function balance(
      ISupplyController supplyController,
      IAmbireAccount account,
      VestingData calldata vestingData,
      uint totalRewardInTree
  ) external returns (EstimationOutcome memory outcome) {
    outcome.rewardsAmount = totalRewardInTree - supplyController.claimed(address(account));

    if (block.timestamp > vestingData.end && supplyController.vestingLastMint(vestingData.recipient, vestingData.end, vestingData.amountPerSecond) >= vestingData.end) {
      outcome.vestingEnded = true;
    } else {
      outcome.vestingAmount = supplyController.mintableVesting(vestingData.recipient, vestingData.end, vestingData.amountPerSecond);
    }
  }
}
