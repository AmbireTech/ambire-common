// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './EstimationStructs.sol';

contract SimulateSigned is EstimationStructs {
  function simulateSigned(
    AccountOp memory op,
    GasLimits memory gasLimits
  ) public returns (SimulationOutcome memory outcome) {
    // safety check in case what's passed in is wrong
    if (op.nonce != op.account.nonce()) {
      outcome.err = bytes('NONCE_ERROR');
      return outcome;
    }
    uint gasInitial = gasleft();
    bool doingFirstSimulation = gasLimits.gasLimit == 0;

    try
      op.account.execute{ gas: doingFirstSimulation ? gasInitial : gasLimits.gasLimit }(
        op.calls,
        op.signature
      )
    {
      outcome.success = true;
    } catch (bytes memory err) {
      outcome.err = err;
    }
    outcome.gasUsed = doingFirstSimulation ? gasInitial - gasleft() : gasLimits.gasLimit;

    if (
      gasLimits.shouldRevertUponSuccessIfFirstSimulation && outcome.success && doingFirstSimulation
    ) {
      revert RevertWithSuccess(outcome.gasUsed);
    }
  }

  /**
   * Execute the accountOp with a set gasLimit and always revert so the state
   * is not modified and the accountOp can be simulated again later.
   * Reverts with RevertWithSuccess(gasLimit) if the execution succeeds
   * and with the execution error otherwise
   */
  function simulateSignedWithoutStateChange(AccountOp memory op, uint256 gasLimit) external {
    try op.account.execute{ gas: gasLimit }(op.calls, op.signature) {
      revert RevertWithSuccess(gasLimit);
    } catch (bytes memory err) {
      assembly {
        revert(add(err, 32), mload(err))
      }
    }
  }

  /**
   * Check whether the accountOp succeeds with the passed gasLimit
   * without modifying the state
   */
  function doesSucceedWithGasLimit(
    AccountOp memory op,
    uint256 gasLimit
  ) internal returns (bool success, bytes memory err) {
    try this.simulateSignedWithoutStateChange(op, gasLimit) {
      // unreachable as simulateSignedWithoutStateChange always reverts
    } catch (bytes memory revertData) {
      if (revertData.length >= 4 && bytes4(revertData) == RevertWithSuccess.selector) {
        return (true, '');
      }
      return (false, revertData);
    }
  }
}
