// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './IAmbireAccount.sol';
import '../libs/Transaction.sol';

contract EstimationStructs {
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
  // Here, we only care about one particular AccountOp (and potentially accountOpToExecuteBefore for recovery finalization)
  struct SimulationOutcome {
    uint gasUsed;
    bool success;
    bytes err;
  }

  struct FeeTokenOutcome {
    uint gasUsed;
    uint amount;
  }
}
