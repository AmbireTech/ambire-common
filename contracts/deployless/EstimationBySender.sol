// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './Estimation.sol';

contract EstimationBySender is Estimation {
  function estimateBySender(
    IAmbireAccount account,
    address factory,
    bytes memory factoryCalldata,
    AccountOp memory op,
    bytes calldata probableCallData,
    address[] memory associatedKeys,
    // Only needed in case we simulate fee tokens
    // @TODO: perhaps we can wrap this in a struct
    address[] memory feeTokens,
    address relayer,
    address[] memory checkNativeAssetOn,
    address oracle
  ) external returns (EstimationOutcome memory outcome) {
    // This has two purposes: 1) when we're about to send a txn via an EOA, we need to know the native asset balances
    // 2) sometimes we need to check the balance of the simulation `from` addr in order to calculate
    // txn fee anomalies (like in Optimism, paying the L1 calldata fee)
    // this is first, because when it comes to paying with native (EOA), the starting balance is taken
    outcome.nativeAssetBalances = new uint[](checkNativeAssetOn.length);
    for (uint i = 0; i != checkNativeAssetOn.length; i++) {
      outcome.nativeAssetBalances[i] = checkNativeAssetOn[i].balance;
    }

    // Do all the simulations
    outcome.deployment = simulateDeployment(account, factory, factoryCalldata);

    if (outcome.deployment.success) {
      outcome.op = simulateUnsignedBySender(op);
      // executeBySender doesn't increment the nonce, so report a synthetic +1
      // on success to preserve the same offchain success signal as estimate().
      outcome.nonce = outcome.op.success ? op.account.nonce() + 1 : op.account.nonce();

      if (feeTokens.length != 0) {
        outcome.feeTokenOutcomes = simulateFeePaymentsBySender(
          account,
          feeTokens,
          relayer,
          calculateBaseGasBySender(account)
        );
      }

      // if an optimistic oracle is passed, simulate the L1 fee
      outcome.l1GasEstimation = this.getL1GasEstimation(probableCallData, relayer, oracle);
    }

    // if there are associatedKeys, check if the account was not bricked
    if (associatedKeys.length != 0 && outcome.op.success) {
      // Safety check: anti-bricking
      bool isOk;
      for (uint i = 0; i != associatedKeys.length; i++) {
        if (op.account.privileges(associatedKeys[i]) != bytes32(0)) {
          isOk = true;
          break;
        }
      }
      require(
        isOk,
        'Anti-bricking check failed, this means that none of the passed associatedKeys has privileges after simulation'
      );
    }
  }

  function simulateUnsignedBySender(
    AccountOp memory op
  ) public returns (SimulationOutcome memory outcome) {
    // setting the nonce is just for the purposes of passing the safety check in simulateBySender
    op.nonce = op.account.nonce();

    try this.simulateBySender(op, GasLimits(0, 0, true)) returns (
      SimulationOutcome memory callsRevertedOutcome
    ) {
      // if simulateBySender enters here while having a gasLimit of 0,
      // it means it has resolved with an error (onchain failure)
      outcome = callsRevertedOutcome;
    } catch (bytes memory revertData) {
      bytes4 selector = RevertWithSuccess.selector;

      // catch should always revert with RevertWithSuccess
      // if anything unexpected happens, return the error back
      if (revertData.length < 4 || bytes4(revertData) != selector) {
        assembly {
          revert(add(revertData, 32), mload(revertData))
        }
      }

      // decode RevertWithSuccess and try again with the calculated gasLimit + 5% buffer
      uint256 gasLimit;
      assembly {
        gasLimit := mload(add(revertData, 36))
      }

      // if the estimated gasLimit is larger than the block gas limit,
      // return an out of gas error as the txn is impossible to complete
      uint256 blockGasLimit = block.gaslimit;
      if (blockGasLimit != 0 && gasLimit > blockGasLimit) {
        outcome.gasUsed = gasLimit;
        outcome.success = false;
        outcome.err = bytes('OOG');
      } else {
        // raise the calculated gas limit by 5% just-in-case
        uint256 raisedGasLimit = gasLimit + gasLimit / 20;

        // the upperLimit should be 3 times the raisedGasLimit unless
        // the upperLimit becomes bigger than the blockGasLimit
        uint256 upperLimit = raisedGasLimit * 3;
        if (upperLimit > blockGasLimit) {
          upperLimit = blockGasLimit;
        }

        outcome = simulateBySender(op, GasLimits(raisedGasLimit, upperLimit, false));
      }
    }
  }

  function simulateBySender(
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
      op.account.executeBySender{ gas: doingFirstSimulation ? gasInitial : gasLimits.gasLimit }(
        op.calls
      )
    {
      outcome.success = true;
    } catch (bytes memory err) {
      outcome.err = err;
    }
    outcome.gasUsed = doingFirstSimulation ? gasInitial - gasleft() : gasLimits.gasLimit;

    bool isCaseWithNoGasLimits = doingFirstSimulation &&
      !gasLimits.shouldRevertUponSuccessIfFirstSimulation;
    bool isRevertingWithoutOOG = doingFirstSimulation && !outcome.success;
    bool isSuccessWithSetGas = !doingFirstSimulation && outcome.success;
    if (isCaseWithNoGasLimits || isRevertingWithoutOOG || isSuccessWithSetGas) {
      return outcome;
    }

    if (
      gasLimits.shouldRevertUponSuccessIfFirstSimulation && outcome.success && doingFirstSimulation
    ) {
      revert RevertWithSuccess(outcome.gasUsed);
    }

    // if the binary search has reached the upperBoundLimit, declare a failure
    if (gasLimits.gasLimit == gasLimits.upperBoundLimit) return outcome;

    // do a binary search, increasing by half of gas limit and upper bound limit
    // until in 10% of range to the upperBoundLimit. When reached, set the
    // gasLimit to the upperBoundLimit and make the last simulation
    gasLimits.gasLimit = (gasLimits.gasLimit + gasLimits.upperBoundLimit) / 2;
    if (gasLimits.gasLimit > (gasLimits.upperBoundLimit - gasLimits.upperBoundLimit / 10)) {
      gasLimits.gasLimit = gasLimits.upperBoundLimit;
    }

    outcome = this.simulateBySender(op, gasLimits);
    outcome.initialGasLimitFailed = true;
  }

  function simulateFeePaymentsBySender(
    IAmbireAccount account,
    address[] memory feeTokens,
    address relayer,
    uint baseGasConsumption
  ) public returns (FeeTokenOutcome[] memory feeTokenOutcomes) {
    feeTokenOutcomes = new FeeTokenOutcome[](feeTokens.length);
    for (uint i = 0; i != feeTokens.length; i++) {
      address feeToken = feeTokens[i];
      AccountOp memory simulationOp;
      simulationOp.account = account;
      simulationOp.nonce = account.nonce();
      simulationOp.calls = new Transaction[](1);

      if (feeToken == address(0)) {
        feeTokenOutcomes[i].amount = address(account).balance;
        simulationOp.calls[0].to = relayer;
        simulationOp.calls[0].value = 1;
      } else {
        simulationOp.calls[0].to = feeToken;
        simulationOp.calls[0].data = abi.encodeWithSelector(
          IERC20Subset.transfer.selector,
          relayer,
          1
        );

        try this.getERC20Balance(IERC20Subset(feeToken), address(account)) returns (uint amount) {
          feeTokenOutcomes[i].amount = amount;
          // Ignore errors on purpose here, we just leave the amount 0
        } catch {}
      }

      // Only simulate if the amount is nonzero
      if (feeTokenOutcomes[i].amount > 0) {
        SimulationOutcome memory outcome = simulateBySender(simulationOp, GasLimits(0, 0, false));
        // We ignore the errors here on purpose, we will just leave gasUsed as 0
        // We only care about `gasUsed - baseGasConsumption` because paying the fee will be a part of
        // another AccountOp, so we don't care about the base AccountOp overhead
        if (outcome.gasUsed > 0) {
          require(outcome.gasUsed >= baseGasConsumption, 'IMPOSSIBLE_GAS_CONSUMPTION');
          feeTokenOutcomes[i].gasUsed = outcome.gasUsed - baseGasConsumption;
        }
      }
    }
  }

  function calculateBaseGasBySender(IAmbireAccount account) internal returns (uint) {
    // Ambire v1 contracts do not support zero-call execute()s, so we have to make
    // two separate measures of executeBySender(), one with one empty call, the other with two,
    // to calculate the base gas used by executeBySender()
    AccountOp memory emptyOp;
    emptyOp.account = account;
    emptyOp.nonce = account.nonce();
    emptyOp.calls = new Transaction[](1);
    // `account` is guaranteed to be in the accessList, so there should be minimum overhead
    emptyOp.calls[0].to = address(this);
    // NOTE: we can call this twice and use the second result, to negate the fact that
    // the first time the account may not be added to the accessList which will distort the difference
    // However, if the previous simulations have been successful it will be, and if they're not, we don't care
    // about the accuracy of the baseGas
    SimulationOutcome memory emptyOpOutcome = simulateBySender(emptyOp, GasLimits(0, 0, false));
    require(
      emptyOpOutcome.success,
      emptyOpOutcome.err.length > 0
        ? string(emptyOpOutcome.err)
        : 'calculateBaseFee: unable to execute emptyOpOutcome, cannot calc base fee'
    );
    AccountOp memory twoCallOp = emptyOp;
    twoCallOp.nonce = account.nonce();
    twoCallOp.calls = new Transaction[](2);
    twoCallOp.calls[0].to = address(this);
    twoCallOp.calls[1].to = address(this);
    SimulationOutcome memory twoCallOpOutcome = simulateBySender(twoCallOp, GasLimits(0, 0, false));
    require(
      twoCallOpOutcome.success,
      twoCallOpOutcome.err.length > 0
        ? string(twoCallOpOutcome.err)
        : 'calculateBaseFee: unable to execute twoCallOpOutcome, cannot calc base fee'
    );

    // This will happen if we haven't accessed the account before. As such, the second one will
    // be the more accurate because subsequent simulations will have accessed the account
    if (emptyOpOutcome.gasUsed > twoCallOpOutcome.gasUsed) return twoCallOpOutcome.gasUsed;

    uint diff = twoCallOpOutcome.gasUsed - emptyOpOutcome.gasUsed;
    return emptyOpOutcome.gasUsed - diff;
  }
}
