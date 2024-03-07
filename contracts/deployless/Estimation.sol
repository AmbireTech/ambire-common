// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './IAmbireAccount.sol';
import './Spoof.sol';

interface IERC20Subset {
  function balanceOf(address account) external view returns (uint256);

  function transfer(address recipient, uint256 amount) external returns (bool);
}

interface IGasPriceOracle {
  function getL1GasUsed(bytes memory _data) external view returns (uint256);

  function getL1Fee(bytes memory _data) external view returns (uint256);

  function l1BaseFee() external view returns (uint256);
}

contract Estimation is Spoof {
  // NOTE: this contract doesn't need to be aware of ERC-4337 or entryPoint/entryPoint.getNonce()
  // It uses account.execute() directly with spoof signatures, this is ok before:
  // 1) signed accountOps (preExecute) are always signed in an agnostic way (using external sig validator, which uses it's own nonce-agnostic hash)
  // 2) the main accountOp to estimate is not signed and we generate a spoof sig for it which works regardless of nonce
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

  struct L1GasEstimation {
    uint256 gasUsed;
    uint256 baseFee;
    uint256 fee;
    uint256 feeWithNativePayment;
    uint256 feeWithTransferPayment;
  }

  struct EstimationOutcome {
    SimulationOutcome deployment;
    SimulationOutcome accountOpToExecuteBefore;
    SimulationOutcome op;
    uint nonce;
    FeeTokenOutcome[] feeTokenOutcomes;
    bytes32[] associatedKeyPrivileges;
    uint[] nativeAssetBalances;
    uint gasUsed;
    L1GasEstimation l1GasEstimation;
  }

  // `estimate` takes the `accountOpToExecuteBefore` parameters separately because it's simulated via `simulateSigned`
  // vs the regular accountOp for which we use simulateUnsigned
  function estimate(
    IAmbireAccount account,
    address factory,
    bytes memory factoryCalldata,
    // @TODO is there a more elegant way than passing those in full
    AccountOp memory preExecute,
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
    // NOTE: if we don't have a preExecute accountOp, .success will still be false, but
    // the estimate lib only cares about the final success (outcome.op.success)
    if (outcome.deployment.success && preExecute.calls.length != 0) {
      outcome.accountOpToExecuteBefore = simulateSigned(preExecute);
    }
    bytes memory spoofSig;
    if (
      outcome.deployment.success &&
      (preExecute.calls.length == 0 || outcome.accountOpToExecuteBefore.success)
    ) {
      (outcome.op, outcome.associatedKeyPrivileges, spoofSig) = simulateUnsigned(
        op,
        associatedKeys
      );
      outcome.nonce = op.account.nonce();
      // Get fee tokens amounts after the simulation, and simulate their gas cost for transfer
      if (feeTokens.length != 0 && spoofSig.length > 0) {
        outcome.feeTokenOutcomes = simulateFeePayments(account, feeTokens, spoofSig, relayer);
      }

      // if an optimistic oracle is passed, simulate the L1 fee
      outcome.l1GasEstimation = this.getL1GasEstimation(probableCallData, relayer, oracle);
    }

    // if there are associatedKeys and a valid spoofSig was generated, check if the account
    // was not bricked
    if (associatedKeys.length != 0 && spoofSig.length > 0) {
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

  function simulateDeployment(
    IAmbireAccount account,
    address factory,
    bytes memory factoryCalldata
  ) public returns (SimulationOutcome memory outcome) {
    if (address(account).code.length > 0) {
      outcome.success = true;
      return outcome;
    }
    uint gasInitial = gasleft();
    (outcome.success, outcome.err) = factory.call(factoryCalldata);
    outcome.gasUsed = gasInitial - gasleft();
  }

  function simulateUnsigned(
    AccountOp memory op,
    address[] memory associatedKeys
  )
    public
    returns (
      SimulationOutcome memory outcome,
      bytes32[] memory associatedKeyPrivileges,
      bytes memory spoofSig
    )
  {
    // setting the nonce is just for the purposes of passing the safety check in simulateSigned; it's a spoof sig so it doesn't matter
    op.nonce = op.account.nonce();
    associatedKeyPrivileges = new bytes32[](associatedKeys.length);
    for (uint i = 0; i != associatedKeys.length; i++) {
      address key = associatedKeys[i];
      bytes32 value = op.account.privileges(key);
      associatedKeyPrivileges[i] = value;
      if (value != bytes32(0)) {
        if (spoofSig.length == 0) spoofSig = makeSpoofSignature(key);
      }
    }
    op.signature = spoofSig;
    if (spoofSig.length > 0) {
      outcome = simulateSigned(op);
    } else {
      outcome.err = bytes('SPOOF_ERROR');
    }
  }

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

  function simulateFeePayments(
    IAmbireAccount account,
    address[] memory feeTokens,
    bytes memory spoofSig,
    address relayer
  ) public returns (FeeTokenOutcome[] memory feeTokenOutcomes) {
    uint baseGasConsumption = calculateBaseGas(account, spoofSig);

    feeTokenOutcomes = new FeeTokenOutcome[](feeTokens.length);
    for (uint i = 0; i != feeTokens.length; i++) {
      address feeToken = feeTokens[i];
      AccountOp memory simulationOp;
      simulationOp.account = account;
      // for the purposes of passing the safety check; otherwise it's a spoof sig and it doesn't matter
      simulationOp.nonce = account.nonce();
      simulationOp.calls = new IAmbireAccount.Transaction[](1);
      simulationOp.signature = spoofSig;

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
        SimulationOutcome memory outcome = simulateSigned(simulationOp);
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

  function calculateBaseGas(IAmbireAccount account, bytes memory spoofSig) internal returns (uint) {
    // Ambire v1 contracts do not support zero-call execute()s, so we have to make
    // two separate measures of execute(), one with one empty call, the other with two,
    // to calculate the base gas used by execute()
    AccountOp memory emptyOp;
    emptyOp.account = account;
    emptyOp.nonce = account.nonce();
    emptyOp.calls = new IAmbireAccount.Transaction[](1);
    emptyOp.signature = spoofSig;
    // `account` is guaranteed to be in the accessList, so there should be minimum overhead
    emptyOp.calls[0].to = address(this);
    // NOTE: we can call this twice and use the second result, to negate the fact that
    // the first time the account may not be added to the accessList which will distort the difference
    // However, if the previous simulations have been successful it will be, and if they're not, we don't care
    // about the accuracy of the baseGas
    SimulationOutcome memory emptyOpOutcome = simulateSigned(emptyOp);
    require(
      emptyOpOutcome.success,
      // @TODO: fix: it is wrong to cast this as string since we'll double-wrap it in Error()
      emptyOpOutcome.err.length > 0
        ? string(emptyOpOutcome.err)
        : 'calculateBaseFee: unable to execute emptyOpOutcome, cannot calc base fee'
    );
    AccountOp memory twoCallOp = emptyOp;
    twoCallOp.nonce = account.nonce();
    twoCallOp.calls = new IAmbireAccount.Transaction[](2);
    twoCallOp.calls[0].to = address(this);
    twoCallOp.calls[1].to = address(this);
    SimulationOutcome memory twoCallOpOutcome = simulateSigned(twoCallOp);
    require(
      twoCallOpOutcome.success,
      // @TODO: fix: it is wrong to cast this as string since we'll double-wrap it in Error()
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

  function getL1GasEstimation(
    bytes calldata data,
    address feeCollector,
    address oracleAddr
  ) external view returns (L1GasEstimation memory l1GasEstimation) {
    if (oracleAddr == address(0)) {
      return l1GasEstimation;
    }

    IGasPriceOracle oracle = IGasPriceOracle(oracleAddr);
    bytes memory nativeFeeCall = abi.encode(feeCollector, 1, '0x');
    bytes memory transferFeeCall = abi.encode(
      feeCollector,
      0,
      abi.encodeWithSelector(IERC20Subset.transfer.selector, feeCollector, 1)
    );

    l1GasEstimation.gasUsed = oracle.getL1GasUsed(data);
    l1GasEstimation.fee = oracle.getL1Fee(data);
    l1GasEstimation.feeWithNativePayment = oracle.getL1Fee(bytes.concat(data, nativeFeeCall));
    l1GasEstimation.feeWithTransferPayment = oracle.getL1Fee(bytes.concat(data, transferFeeCall));
    l1GasEstimation.baseFee = oracle.l1BaseFee();
  }

  // We need this function so that we can try-catch the parsing of the return value as well
  function getERC20Balance(IERC20Subset token, address addr) external view returns (uint) {
    return token.balanceOf(addr);
  }

  // Empty fallback so we can call ourselves from the account
  fallback() external payable {}

  receive() external payable {}
}
