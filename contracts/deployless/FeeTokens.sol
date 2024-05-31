// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './SimulateSigned.sol';
import './IERC20Subset.sol';
import '../libs/Transaction.sol';

contract FeeTokens is SimulateSigned {
  function simulateFeePayments(
    IAmbireAccount account,
    address[] memory feeTokens,
    bytes memory spoofSig,
    address relayer,
    uint baseGasConsumption
  ) public returns (FeeTokenOutcome[] memory feeTokenOutcomes) {
    feeTokenOutcomes = new FeeTokenOutcome[](feeTokens.length);
    for (uint i = 0; i != feeTokens.length; i++) {
      address feeToken = feeTokens[i];
      AccountOp memory simulationOp;
      simulationOp.account = account;
      // for the purposes of passing the safety check; otherwise it's a spoof sig and it doesn't matter
      simulationOp.nonce = account.nonce();
      simulationOp.calls = new Transaction[](1);
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

  /**
   * If we don't have a valid spoof signature, we return the current balances
   * of the fee tokens. This is in the case of a view only account
   *
   * @param account IAmbireAccount
   * @param feeTokens array of fee token addresses, native is zero addr
   */
  function getFeeTokenBalances(
    IAmbireAccount account,
    address[] memory feeTokens
  ) public view returns (FeeTokenOutcome[] memory feeTokenOutcomes) {
    feeTokenOutcomes = new FeeTokenOutcome[](feeTokens.length);
    for (uint i = 0; i != feeTokens.length; i++) {
      address feeToken = feeTokens[i];
      if (feeToken == address(0)) {
        feeTokenOutcomes[i].amount = address(account).balance;
      } else {
        try this.getERC20Balance(IERC20Subset(feeToken), address(account)) returns (uint amount) {
          feeTokenOutcomes[i].amount = amount;
          // Ignore errors on purpose here, we just leave the amount 0
        } catch {}
      }
    }
  }

  // We need this function so that we can try-catch the parsing of the return value as well
  function getERC20Balance(IERC20Subset token, address addr) external view returns (uint) {
    return token.balanceOf(addr);
  }
}
