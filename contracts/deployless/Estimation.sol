// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "./IAmbireAccount.sol";

contract Estimation {
  struct AccountOp {
    IAmbireAccount account;
    uint nonce;
    IAmbireAccount.Transaction[] calls;
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

  struct EstimationOutcome {
    SimulationOutcome deployment;
    SimulationOutcome accountOpToExecuteBefore;
  }

  function makeSpoofSignature(address account) internal pure returns (bytes memory spoofSig) {
    spoofSig = abi.encodePacked(uint256(uint160(account)), uint8(0x03));
  }

  function simulateDeployment(
    IAmbireAccount account,
    address factory, bytes memory factoryCalldata
  ) public returns (SimulationOutcome memory outcome) {
    uint gasInitial = gasleft();
    if (address(account).code.length == 0) {
      (outcome.success, outcome.err) = factory.call(factoryCalldata);
    }
    outcome.gasUsed = gasInitial - gasleft();
  }

  function simulateSigned(AccountOp memory op) public returns (SimulationOutcome memory outcome) {
    if (op.nonce != op.account.nonce()) {
      outcome.err = bytes("NONCE_ERROR");
    }
    uint gasInitial = gasleft();
    try op.account.execute(op.calls, op.signature) {
      outcome.success = true;
    } catch (bytes memory err) {
      outcome.err = err;
    }
    outcome.gasUsed = gasInitial - gasleft();
  }

  // @TODO simulateFeePayments
  // @TODO nativeBalances
  // @TODO simulateComplete that also returns gasPrice, nativeBalance
  // @TODO `estimate` takes the `accountOpToExecuteBefore` parameters separately because it's simulated via `simulateSigned`
  // vs the regular accountOp for which we use siimulateNonSigned

}
