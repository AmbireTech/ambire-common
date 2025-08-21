// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './EstimationStructs.sol';

contract SimulateSigned is EstimationStructs {
  function simulateSigned(
    AccountOp memory op,
    uint256 gasLimit,
    bool shouldRevertIfConditionsMet
  ) public returns (SimulationOutcome memory outcome) {
    // safety check in case what's passed in is wrong
    if (op.nonce != op.account.nonce()) {
      outcome.err = bytes('NONCE_ERROR');
      return outcome;
    }
    uint gasInitial = gasleft();
    uint executionGas = gasLimit != 0 ? gasLimit : gasInitial;

    try op.account.execute{ gas: executionGas }(op.calls, op.signature) {
      outcome.success = true;
    } catch (bytes memory err) {
      outcome.err = err;
    }
    outcome.gasUsed = gasInitial - gasleft();

    if (shouldRevertIfConditionsMet) {
      // a success outcome with a 0 gasLimit means calls are legit
      // but we should estimate if the passed gasLimit is enough
      if (outcome.success && gasLimit == 0) {
        revert RevertWithSuccess(outcome.gasUsed);
      }

      // gas limit was not enough
      if (!outcome.success && gasLimit > 0) {
        revert OOG();
      }
    }
  }
}
