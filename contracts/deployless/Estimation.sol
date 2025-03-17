// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './Spoof.sol';
import './IERC20Subset.sol';
import './FeeTokens.sol';
import '../libs/Transaction.sol';

interface IGasPriceOracle {
  function getL1GasUsed(bytes memory _data) external view returns (uint256);

  function getL1Fee(bytes memory _data) external view returns (uint256);

  function l1BaseFee() external view returns (uint256);
}

contract Estimation is FeeTokens, Spoof {
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

  struct EoaEstimationOutcome {
    uint gasUsed;
    FeeTokenOutcome[] feeTokenOutcomes;
    L1GasEstimation l1GasEstimation;
    uint[] gasUsedPerCall;
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
      if (feeTokens.length != 0) {
        // in general, we should posses a valid spoofSig for:
        // - EOAs, we make a state override and add a valid spoofSig
        // - SA, we have it from creation
        // - viewOnly, we override for EOA and have it from the relayer for SA
        // The only situation where we don't have a valid spoofSig is something
        // like this: 1) use the extension on 2 PCs 2) remove the only key from one
        // 3) use the other. In this extremely rare scenario instead of reverting,
        // we return the user balances
        if (spoofSig.length > 0) {
          // Get fee tokens amounts after the simulation, and simulate their gas cost for transfer
          outcome.feeTokenOutcomes = simulateFeePayments(
            account,
            feeTokens,
            spoofSig,
            relayer,
            calculateBaseGas(account, spoofSig)
          );
        } else {
          outcome.feeTokenOutcomes = getFeeTokenBalances(account, feeTokens);
        }
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

  function estimateEoa(
    IAmbireAccount account,
    AccountOp memory op,
    bytes calldata probableCallData,
    address[] memory associatedKeys,
    address relayer,
    address oracle
  ) external returns (EoaEstimationOutcome memory eoa) {
    SimulationOutcome memory simulation;

    uint[] memory gasUsedPerCall = new uint[](op.calls.length);
    for (uint256 i = 0; i < op.calls.length; i++) {
      Transaction[] memory callsOneByOne = new Transaction[](1);
      callsOneByOne[0] = op.calls[i];
      AccountOp memory oneCallOp = AccountOp(op.account, op.nonce, callsOneByOne, op.signature);
      (simulation, , ) = simulateUnsigned(oneCallOp, associatedKeys);

      gasUsedPerCall[i] = simulation.gasUsed;
      eoa.gasUsed += simulation.gasUsed;
    }
    eoa.gasUsedPerCall = gasUsedPerCall;

    // record the native balance after the simulation
    FeeTokenOutcome[] memory feeTokenOutcomes = new FeeTokenOutcome[](1);
    feeTokenOutcomes[0].amount = address(account).balance;
    eoa.feeTokenOutcomes = feeTokenOutcomes;

    // if an optimistic oracle is passed, simulate the L1 fee
    eoa.l1GasEstimation = this.getL1GasEstimation(probableCallData, relayer, oracle);
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

  function calculateBaseGas(IAmbireAccount account, bytes memory spoofSig) internal returns (uint) {
    // Ambire v1 contracts do not support zero-call execute()s, so we have to make
    // two separate measures of execute(), one with one empty call, the other with two,
    // to calculate the base gas used by execute()
    AccountOp memory emptyOp;
    emptyOp.account = account;
    emptyOp.nonce = account.nonce();
    emptyOp.calls = new Transaction[](1);
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
    twoCallOp.calls = new Transaction[](2);
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

  // Empty fallback so we can call ourselves from the account
  fallback() external payable {}

  receive() external payable {}
}
