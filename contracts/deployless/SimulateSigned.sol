// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './EstimationStructs.sol';

contract SimulateSigned is EstimationStructs {
  function simulateSigned(AccountOp memory op) public returns (SimulationOutcome memory outcome) {
    // safety check in case what's passed in is wrong
    if (op.nonce != op.account.nonce()) {
      outcome.err = bytes('NONCE_ERROR');
      return outcome;
    }
    uint gasInitial = gasleft();
    // @TODO: if `account` is not a valid acc, this will blow up; consider wrapping it in an internal call,
    // but we prob won't do this cuz of the gas overhead that will distort the overall estimation
    try op.account.execute(op.calls, op.signature) {
      outcome.success = true;
    } catch (bytes memory err) {
      outcome.err = err;
    }
    outcome.gasUsed = gasInitial - gasleft();
  }
}
