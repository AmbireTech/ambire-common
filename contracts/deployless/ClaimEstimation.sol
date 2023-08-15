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

interface IFactory {
	function deploy(bytes calldata code, uint256 salt) external;
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

  struct DeployOutcome {
    bool success;
    bytes err;
  }

  struct AccountCreationData {
      address factory;
      bytes byteCode;
      uint256 salt;
      address[] associatedKeys;
  }

  function makeSpoofSignature(address key) internal pure returns (bytes memory spoofSig) {
    spoofSig = abi.encodePacked(uint256(uint160(key)), uint8(0x03));
  }

  function simulateDeployment(
    IAmbireAccount account,
    address factory,
    bytes memory code,
    uint256 salt 
  ) internal returns (DeployOutcome memory outcome) {
    if (address(account).code.length == 0) {
      bytes memory callData = abi.encodeWithSelector(IFactory(factory).deploy.selector, code, salt);
      (outcome.success, outcome.err) = factory.call(callData);
    } else {
      outcome.success = true;
      outcome.err = hex"00";
    }
  }

  function estimate(
      address supplyControllerAddr,
      address walletERC20Addr,
      address xWalletERC20Addr,
      IAmbireAccount account,
      AccountCreationData calldata creationData,
      VestingData calldata vestingData,
      RewardsData calldata rewardsData
  ) external returns (EstimationOutcome memory outcome) {

    DeployOutcome memory deployOutcome = simulateDeployment(account, creationData.factory, creationData.byteCode, creationData.salt);
    require(deployOutcome.success, "DEPLOY_SIMULATION_ERROR");

    bytes memory spoofSig;
    if (creationData.associatedKeys.length != 0) {
      // Safety check: anti-bricking
      bool isOk;
      for (uint i=0; i != creationData.associatedKeys.length; i++) {
        if (account.privileges(creationData.associatedKeys[i]) != bytes32(0)) {
          spoofSig = makeSpoofSignature(creationData.associatedKeys[i]);
          isOk = true;
          break;
        }
      }
      require(isOk, "NO_VALID_KEY_PROVIDED");
    }

    if (vestingData.recipient != address(0)){
      uint256 walletAmount = IERC20Subset(walletERC20Addr).balanceOf(address(account));
      IAmbireAccount.Transaction[] memory vestingOp = new IAmbireAccount.Transaction[](1);
      vestingOp[0].to = address(supplyControllerAddr);
      vestingOp[0].value = 0;
      vestingOp[0].data = abi.encodeWithSelector(ISupplyController(supplyControllerAddr).mintVesting.selector, vestingData.recipient, vestingData.end, vestingData.amountPerSecond);
      account.execute(vestingOp, spoofSig);
      outcome.walletAmount = IERC20Subset(walletERC20Addr).balanceOf(address(account)) - walletAmount;
    }

    if (rewardsData.totalRewardInTree != 0) {
      uint256 xWalletAmount = IERC20Subset(xWalletERC20Addr).balanceOf(address(account));
      IAmbireAccount.Transaction[] memory rewardsOp = new IAmbireAccount.Transaction[](1);
      rewardsOp[0].to = address(supplyControllerAddr);
      rewardsOp[0].value = 0;
      rewardsOp[0].data = abi.encodeWithSelector(
          ISupplyController(supplyControllerAddr).claimWithRootUpdate.selector,
          rewardsData.totalRewardInTree,
          rewardsData.proof,
          rewardsData.toBurnBps,
          rewardsData.stakingPool,
          rewardsData.newRoot,
          rewardsData.signature
      );
      account.execute(rewardsOp, spoofSig);
      outcome.xWalletAmount = IERC20Subset(xWalletERC20Addr).balanceOf(address(account)) - xWalletAmount;  
    }
    
    return outcome;
  }
    
}