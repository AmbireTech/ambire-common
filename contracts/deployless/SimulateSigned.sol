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
    bool isGasLimitZero = gasLimits.gasLimit == 0;

    try
      op.account.execute{ gas: isGasLimitZero ? gasInitial : gasLimits.gasLimit }(
        op.calls,
        op.signature
      )
    {
      outcome.success = true;
    } catch (bytes memory err) {
      outcome.err = err;
    }
    outcome.gasUsed = isGasLimitZero ? gasInitial - gasleft() : gasLimits.gasLimit;

    bool isCaseWithNoGasLimits = isGasLimitZero && !gasLimits.shouldRevertIfConditionsMet;
    bool isRevertingWithoutOOG = isGasLimitZero && !outcome.success;
    bool isSuccessWithSetGas = !isGasLimitZero && outcome.success;
    if (isCaseWithNoGasLimits || isRevertingWithoutOOG || isSuccessWithSetGas) {
      return outcome;
    }

    if (gasLimits.shouldRevertIfConditionsMet && outcome.success && isGasLimitZero) {
      revert RevertWithSuccess(outcome.gasUsed);
    }

    /////////////////////////////////////////////////////////////////
    //                  success: false with OOG                    //
    /////////////////////////////////////////////////////////////////

    // if the binary search has reached the upperBoundLimit, declare a failure
    if (gasLimits.gasLimit == gasLimits.upperBoundLimit) return outcome;

    // do a binary search, increasing by half of gas limit and upper bound limit
    // until in 10% of range to the upperBoundLimit. When reached, set the
    // gasLimit to the upperBoundLimit and make the last simulation
    gasLimits.gasLimit = (gasLimits.gasLimit + gasLimits.upperBoundLimit) / 2;
    if (gasLimits.gasLimit > (gasLimits.upperBoundLimit - gasLimits.upperBoundLimit / 10)) {
      gasLimits.gasLimit = gasLimits.upperBoundLimit;
    }

    outcome = this.simulateSigned(op, gasLimits);
    outcome.initialGasLimitFailed = true;
  }
}
