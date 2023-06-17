// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "./IAmbireAccount.sol";

interface IERC20Subset {
  function balanceOf(address account) external view returns (uint256);
  function transfer(address recipient, uint256 amount) external returns (bool);
}

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
    FeeTokenOutcome[] feeTokenOutcomes;
    bool[] isKeyAuthorized;
    uint[] nativeAssetBalances;
  }

  function makeSpoofSignature(address key) internal pure returns (bytes memory spoofSig) {
    spoofSig = abi.encodePacked(uint256(uint160(key)), uint8(0x03));
  }

  // `estimate` takes the `accountOpToExecuteBefore` parameters separately because it's simulated via `simulateSigned`
  // vs the regular accountOp for which we use simulateUnsigned
  function estimate(
    IAmbireAccount account,
    address factory, bytes memory factoryCalldata,
    // @TODO is there a more elegant way than passing those in full
    AccountOp memory preExecute,
    AccountOp memory op,
    address[] memory associatedKeys,
    // Only needed in case we simulate fee tokens
    // @TODO: perhaps we can wrap this in a struct
    address[] memory feeTokens,
    address relayer,
    address[] memory checkNativeAssetOn
  ) external returns (EstimationOutcome memory outcome) {
    // This has two purposes: 1) when we're about to send a txn via an EOA, we need to know the native asset balances
    // 2) sometimes we need to check the balance of the simulation `from` addr in order to calculate
    // txn fee anomalies (like in Optimism, paying the L1 calldata fee)
    outcome.nativeAssetBalances = new uint[](checkNativeAssetOn.length);
    for (uint i=0; i!=checkNativeAssetOn.length; i++) {
      outcome.nativeAssetBalances[i] = checkNativeAssetOn[i].balance;
    }

    // Do all the simulations
    outcome.deployment = simulateDeployment(account, factory, factoryCalldata);
    if (!outcome.deployment.success) return outcome;
    // NOTE: if we don't have a preExecute accountOp, .success will still be false, but
    // the estimate lib only cares about the final success (outcome.op.success)
    if (preExecute.calls.length != 0) {
      outcome.accountOpToExecuteBefore = simulateSigned(op);
      if (!outcome.accountOpToExecuteBefore.success) return outcome;
    }
    (outcome.op, outcome.isKeyAuthorized) = simulateUnsigned(op, associatedKeys);
    // @TODO: spoof signature, since Solidity copies the memory arguments and we can't just read the one set by simulateUnsigned
    if (feeTokens.length != 0) outcome.feeTokenOutcomes = simulateFeePayments(account, feeTokens, op.signature, relayer);
    // Safety check: anti-bricking
    bool isOk;
    for (uint i=0; i!=associatedKeys.length; i++) {
      if (op.account.privileges(associatedKeys[i]) != bytes32(0)) { isOk = true; break; }
    }
    require(isOk, "ANTI_BRICKING_FAILED");
  }

  function simulateDeployment(
    IAmbireAccount account,
    address factory, bytes memory factoryCalldata
  ) public returns (SimulationOutcome memory outcome) {
    if (address(account).code.length > 0) {
      outcome.success = true;
      return outcome;
    }
    uint gasInitial = gasleft();
    (outcome.success, outcome.err) = factory.call(factoryCalldata);
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
      return outcome;
    }
    uint gasInitial = gasleft();
    try op.account.execute(op.calls, op.signature) {
      outcome.success = true;
    } catch (bytes memory err) {
      outcome.err = err;
    }
    outcome.gasUsed = gasInitial - gasleft();
  }

  function simulateFeePayments(IAmbireAccount account, address[] memory feeTokens, bytes memory spoofSig, address relayer)
    public
    returns (FeeTokenOutcome[] memory feeTokenOutcomes)
  {
    /*
    AccountOp memory emptyOp;
    emptyOp.signature = spoofSig;
    emptyOp.calls = new IAmbireAccount.Transaction[](1);
    emptyOp.calls[0].to = address(account);
    SimulationOutcome memory emptyOpOutcome = simulateSigned(emptyOp);
    require(
      emptyOpOutcome.success,
      // @TODO: fix: it is wrong to cast this as string since we'll double-wrap it in Error()
      emptyOpOutcome.err.length > 0 ? string(emptyOpOutcome.err) : "FEE_BASE_GASUSED"
    );
    */

    uint baseGasConsumption = 0;//emptyOpOutcome.gasUsed;

    feeTokenOutcomes = new FeeTokenOutcome[](feeTokens.length);
    for (uint i=0; i!=feeTokens.length; i++) {
      address feeToken = feeTokens[i];
      AccountOp memory simulationOp;
      simulationOp.calls = new IAmbireAccount.Transaction[](1);

      if (feeToken == address(0)) {
        feeTokenOutcomes[i].amount = address(account).balance;
        simulationOp.calls[0].to = relayer;
        simulationOp.calls[0].value = 1;
      } else {
        simulationOp.calls[0].to = feeToken;
        simulationOp.calls[0].data = abi.encodeWithSelector(IERC20Subset.transfer.selector, relayer, 1);
        try this.getERC20Balance(IERC20Subset(feeToken), address(account)) returns (uint amount) {
          feeTokenOutcomes[i].amount = amount;
        // Ignore errors on purpose here, we just leave the amount 0
        } catch {}
      }

      // Only simulate if the amount is nonzero
      /*
      if (feeTokenOutcomes[i].amount > 0) {
        SimulationOutcome memory outcome = simulateSigned(simulationOp);
        // We ignore the errors here on purpose, we will just leave gasUsed as 0
        // We only care about `gasUsed - baseGasConsumption` because paying the fee will be a part of
        // another AccountOp, so we don't care about the base AccountOp overhead
        if (outcome.gasUsed > 0) {
          require(outcome.gasUsed >= baseGasConsumption, "IMPOSSIBLE_GAS_CONSUMPTION");
          feeTokenOutcomes[i].gasUsed = outcome.gasUsed - baseGasConsumption;
        }
      }
      */
    }
  }

  // We need this function so that we can try-catch the parsing of the return value as well
  function getERC20Balance(IERC20Subset token, address addr) external view returns (uint) {
    return token.balanceOf(addr);
  }
  // @TODO nativeBalances
}
