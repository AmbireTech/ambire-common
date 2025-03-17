import { AccountOp } from '../accountOp/accountOp'
import { AccountOpStatus } from '../accountOp/types'
import { PendingAmounts } from './interfaces'

/**
 * Function for calculating the pending balance and the delta amounts
 * for pendingToBeSigned and pendingToBeConfirmed states (referred to as token badges) of a token.
 *
 * While calculating the balance is a routine operation,
 * calculating the pending delta and determining its state (whether it needs to be signed or confirmed)
 * can be quite challenging.
 *
 * We use this function's output to display PendingToBeSigned, PendingToBeConfirmed, or both badges on the Dashboard.
 *
 * Here's the main mechanism for handling the pending state and simulation:
 * 1. Once we have an AccountOp, we perform a simulation against the pending block. The `PendingToBeSigned` badge is shown.
 * 2. After broadcasting the AccountOp, we update its status to `PendingToBeConfirmed`. The `PendingToBeConfirmed` badge appears.
 * 3. After broadcasting, we ensure the AccountPortfolio is not updated immediately to avoid losing the simulation and badge.
 * 4. Even if we try updating with the previous simulation, it won't work as the account nonce will already be incremented.
 * 5. Once the transaction is confirmed, the AccountPortfolio is updated. The simulation and the `PendingToBeConfirmed` badge clear.
 * 6. If the user refreshes or the transaction delays, the portfolio updates automatically, clearing the simulation. This is acceptable.
 *
 * Let's review the main scenarios where we encounter simulation (simulatedAccountOp), followed by a discussion of corner cases.
 *
 * Main scenarios:
 * 1. If there is an AccOp that has not yet been signed, we return the `pendingToBeSigned` amount.
 * 2. If there is an AccOp that has been signed and broadcasted (but not yet confirmed),
 *    we display the `pendingToBeConfirmed` badge, reflecting the corresponding amount.
 * 3. If we detect a delta between the pending and latest token amounts, it indicates that there is something awaiting confirmation.
 *    In this case, we also return the `pendingToBeConfirmed` amount.
 *    For example, if someone sends you tokens outside of the extension, the extension will show the `pendingToBeConfirmed` amount.
 *
 * Rare scenarios:
 * 1. It is possible to have both `pendingToBeSigned` and `pendingToBeConfirmed` badges in the following scenario:
 *    - If someone sends you tokens, the `latestPendingDelta` is triggered.
 *      At the same time, if you have an AccOp waiting to be signed, both badges will be displayed,
 *       and the amounts for `pendingToBeSigned` and `pendingToBeConfirmed` will be calculated.
 * 2. If you sign and broadcast an AccOp while the `latestPendingDelta` also has a value,
 *    the `pendingToBeConfirmed` badge will be displayed, representing the sum of both `simulationDelta` and `pendingLatestDelta`.
 *    - This is similar to the previous case, but here the AccOp has been broadcasted.
 *      When there is a delta between the latest and pending block amounts, both deltas are summed, resulting in the `pendingToBeConfirmed` amount.
 */
export const calculatePendingAmounts = (
  latestAmount: bigint,
  pendingAmount: bigint,
  amountPostSimulation?: bigint,
  simulationDelta?: bigint, // pending delta (this is the amount of the simulation itself)
  simulatedAccountOp?: AccountOp
): PendingAmounts | null => {
  let latestPendingDelta = pendingAmount - latestAmount

  // Dynamically calculate the threshold as 0.0001% of the pendingAmount
  // Use a minimum threshold of 10000n to avoid a zero threshold
  const threshold = pendingAmount > 0n ? pendingAmount / 1_000_000n : 10000n

  // Check if the change in latestPendingDelta is significant (>= threshold or <= -threshold).
  // This helps to avoid processing insignificant changes in the pending balance.
  // This is important for handling tokens with pending balances, such as those deposited into AAVE.
  // With AAVE each block generates a small amount of interest or rewards,
  // which is constantly displaying on dashboard as pending to be confirmed.
  // The percentage change helps determine if the change in pending balance is significant enough to consider.
  const significantChange = Math.abs(Number(latestPendingDelta)) >= Number(threshold)

  // Ignore changes without significant difference
  if (!significantChange) {
    latestPendingDelta = 0n
  }

  // There is no Pending state changes
  if (latestPendingDelta === 0n && !simulationDelta) return null

  let pendingBalance

  // If there is a latest/pending block delta, but there is no a simulation,
  // set the pending token's balance to equal to the pending block amount.
  if (latestPendingDelta && !amountPostSimulation) {
    pendingBalance = pendingAmount
  } else {
    // Otherwise, if we have a simulation, the pending balance is equal to the simulation amount
    pendingBalance = amountPostSimulation!
  }

  // Okay, we already know that we have a pending state,
  // but in the following lines, we need to set the pendingToBeSigned and pendingToBeConfirmed states.
  const result: PendingAmounts = {
    isPending: true,
    pendingBalance
  }

  if (simulationDelta) {
    // When we broadcast the AccountOp, we set the status of the simulated AccountOp to `BroadcastedButNotConfirmed`
    // until the transaction is confirmed or the user forcefully refreshes their portfolio balance and clears the simulation.
    // When the SimulatedAccountOp has the status `BroadcastedButNotConfirmed`, we know that the pending badge is `pendingToBeConfirmed`.
    const hasPendingToBeConfirmed =
      simulatedAccountOp?.status === AccountOpStatus.BroadcastedButNotConfirmed

    if (hasPendingToBeConfirmed) {
      // Main scenario #2.
      result.pendingToBeConfirmed = simulationDelta
    } else {
      // Main scenario #1.
      result.pendingToBeSigned = simulationDelta
    }
  }

  if (latestPendingDelta) {
    result.pendingToBeConfirmed = result.pendingToBeConfirmed
      ? result.pendingToBeConfirmed + latestPendingDelta // Rare scenario #2.
      : latestPendingDelta // Main scenario #3.
  }

  return result
}
