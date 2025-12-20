// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

import './IAmbireAccount.sol';
import '../libs/Transaction.sol';

contract EstimationStructs {
  error RevertWithSuccess(uint256 gasUsed);
  error OOG();

  // NOTE: this contract doesn't need to be aware of ERC-4337 or entryPoint/entryPoint.getNonce()
  // It uses account.execute() directly with spoof signatures, this is ok before:
  // 1) signed accountOps (preExecute) are always signed in an agnostic way (using external sig validator, which uses it's own nonce-agnostic hash)
  // 2) the main accountOp to estimate is not signed and we generate a spoof sig for it which works regardless of nonce
  struct AccountOp {
    IAmbireAccount account;
    uint nonce;
    Transaction[] calls;
    bytes signature;
  }

  // We do not care about nonces here, unlike portfolio simulations
  // In portfolio simulations we may want to simulate multiple AccountOps and see what nonce we started with, to know where the executing node is
  // Here, we only care about one particular AccountOp
  struct SimulationOutcome {
    uint gasUsed;
    bool success;
    bytes err;
    bool initialGasLimitFailed;
  }

  struct FeeTokenOutcome {
    uint gasUsed;
    uint amount;
  }

  struct GasLimits {
    // gas limit of zero means that we are running an unlimited simulation,
    // we use this for the very first simulation
    uint256 gasLimit;
    uint256 upperBoundLimit;
    // whether we should revert with the outcome of a successful simulation
    // with a set gasLimit of 0, meaning it is the first simulation.
    // The goal of this is to simulate an accountOp WITHOUT modifying the state,
    // so we can simulate it again later
    bool shouldRevertUponSuccessIfFirstSimulation;
  }
}
