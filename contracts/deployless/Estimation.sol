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

  struct FeeTokenOutcome {
    uint gasUsed;
    uint amount;
  }

  struct EstimationOutcome {
    SimulationOutcome deployment;
    SimulationOutcome accountOpToExecuteBefore;
    SimulationOutcome op;
    bool[] isKeyAuthorized;
    uint gasPrice;
    // uint baseFee;
    uint nativeAsset;
  }

  function makeSpoofSignature(address key) internal pure returns (bytes memory spoofSig) {
    spoofSig = abi.encodePacked(uint256(uint160(key)), uint8(0x03));
  }

  // @TODO set gasPrice, baseFee, nativeAsset
  function estimate(
    IAmbireAccount account,
    address factory, bytes memory factoryCalldata,
    // @TODO is there a more elegant way than passing those in full
    AccountOp memory preExecute,
    AccountOp memory op,
    address[] memory associatedKeys
  ) external returns (EstimationOutcome memory outcome) {
    outcome.nativeAsset = msg.sender.balance;
    // @TODO will this block.basefee thing blow up on networks that don't support it?
    // outcome.baseFee = block.basefee;
    outcome.gasPrice = tx.gasprice;
    // Do all the simulations
    outcome.deployment = simulateDeployment(account, factory, factoryCalldata);
    if (!outcome.deployment.success) return outcome;
    if (preExecute.calls.length != 0) outcome.accountOpToExecuteBefore = simulateSigned(op);
    if (!outcome.accountOpToExecuteBefore.success) return outcome;
    (outcome.op, outcome.isKeyAuthorized) = simulateUnsigned(op, associatedKeys);
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

  function simulateUnsigned(AccountOp memory op, address[] memory associatedKeys)
    public
    returns (SimulationOutcome memory outcome, bool[] memory isKeyAuthorized)
  {
    isKeyAuthorized = new bool[](associatedKeys.length);
    for (uint i=0; i!=associatedKeys.length; i++) {
      address key = associatedKeys[i];
      if (op.account.privileges(key) != bytes32(0)) {
        isKeyAuthorized[i] = true;
        if (op.signature.length == 0) op.signature = makeSpoofSignature(key);
      }
    }
    outcome = simulateSigned(op);
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

  function simulateFeePayments(IAmbireAccount account, address[] memory feeTokens)
    public
    returns (FeeTokenOutcome[] memory feeTokenOutcomes)
  {
  }

  // @TODO simulateFeePayments
  // @TODO nativeBalances
  // @TODO `estimate` takes the `accountOpToExecuteBefore` parameters separately because it's simulated via `simulateSigned`
  // vs the regular accountOp for which we use siimulateNonSigned

}
