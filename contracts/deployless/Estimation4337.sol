// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import 'contracts/libs/erc4337/IEntryPoint.sol';

contract Estimation4337 {
  struct EstimationResult {
    uint256 verificationGasLimit;
    uint256 gasUsed;
    bytes failure;
  }

  function estimate(
    UserOperation calldata userOp,
    address entryPointAddr
  ) external returns (EstimationResult memory res) {
    IEntryPoint entryPoint = IEntryPoint(entryPointAddr);
    try entryPoint.simulateHandleOp(userOp, address(0), '0x') {
      revert('Entry point simulation should always revert');
    } catch (bytes memory err) {
      // the simulation always reverts with ExecutionResult if it's successful.
      // If it's not, it will revert with another reason. So we check the revert
      // selector and if it's not ExecutionResult, we stop and return it
      if (abi.decode(err, (bytes4)) != IEntryPoint.ExecutionResult.selector) {
        res.failure = err;
      } else {
        (res.verificationGasLimit, res.gasUsed) = this.getGasUsedByUserOp(userOp, err);
      }
    }
  }

  function getGasUsedByUserOp(
    UserOperation calldata userOp,
    bytes calldata err
  ) external view returns (uint256 verificationGasLimit, uint256 gasUsed) {
    uint256 paid;
    (verificationGasLimit, paid, , , , ) = abi.decode(
      err[4:],
      (uint256, uint256, uint48, uint48, bool, bytes)
    );

    // @copy-paste from EntryPoint.sol
    // calculate the gasPrice so we can figure out the gas used
    uint256 maxFeePerGas = userOp.maxFeePerGas;
    uint256 maxPriorityFeePerGas = userOp.maxPriorityFeePerGas;
    uint256 gasPrice;
    if (maxFeePerGas == maxPriorityFeePerGas) {
      //legacy mode (for networks that don't support basefee opcode)
      gasPrice = maxFeePerGas;
    } else {
      gasPrice = min(maxFeePerGas, maxPriorityFeePerGas + block.basefee);
    }

    gasUsed = paid / gasPrice;
  }

  function min(uint256 a, uint256 b) internal pure returns (uint256) {
    return a < b ? a : b;
  }

  // Empty fallback so we can call ourselves from the account
  fallback() external payable {}

  receive() external payable {}
}
