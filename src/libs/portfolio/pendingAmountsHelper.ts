import { PendingAmounts } from './interfaces'

/**
 * Function for calculating the pending balance and the delta amounts
 * for pendingToBeSigned and pendingToBeConfirmed states (referred to as token badges) of a token.
 *
 * While calculating the balance is a routine operation,
 * calculating the pending delta and determining its state (whether it needs to be signed or confirmed)
 * can be quite challenging.
 *
 * We use this information to display PendingToBeSigned, PendingToBeConfirmed, or both badges on the Dashboard.
 *
 * Let's review the main scenarios where we encounter delta amounts, followed by a discussion of corner cases.
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
  activityNonce?: bigint,
  portfolioNonce?: bigint
): PendingAmounts | null => {
  const latestPendingDelta = pendingAmount - latestAmount

  // Calculate the percentage change between the latest amount and the pending amount.
  // This is important for handling tokens with pending balances, such as those deposited into AAVE.
  // With AAVE each block generates a small amount of interest or rewards,
  // which is constantly displaying on dashboard as pending to be confirmed.
  // The percentage change helps determine if the change in pending balance is significant enough to consider.
  // If the percentage change is below the defined threshold, it is ignored to avoid processing insignificant changes.
  const percentageThreshold = 0.01
  const latestAmountAbs = latestAmount === 0n ? 1n : latestAmount // Avoid division by 0
  const percentageChange = Number((latestPendingDelta * 10000n) / latestAmountAbs) / 100

  // Ignore changes below the threshold
  if (Math.abs(percentageChange) < percentageThreshold) return null

  // There is no Pending state changes
  if (latestPendingDelta === 0n && !simulationDelta) return null

  let pendingBalance

  if (latestPendingDelta && !amountPostSimulation) {
    pendingBalance = pendingAmount
  } else {
    pendingBalance = amountPostSimulation!
  }

  const result: PendingAmounts = {
    isPending: true,
    pendingBalance
  }

  if (simulationDelta) {
    // When an AccOp has not yet been signed and broadcasted, it is not added to the ActivityController.
    // As a result, the latest known ActivityController nonce will always be lower than the Portfolio's pending simulation nonce.
    // In this scenario, we know there is a `pendingToBeSigned` amount.
    // However, once the AccOp is broadcasted and added to the Activity, there is a brief period
    // where the Activity nonce matches the latest simulation nonce, indicating a `pendingToBeConfirmed` amount.
    // Once the AccOp is confirmed by the network, the portfolio is updated, the simulation is cleared, and no badges are displayed.
    const hasPendingToBeConfirmed = activityNonce && activityNonce === portfolioNonce

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
