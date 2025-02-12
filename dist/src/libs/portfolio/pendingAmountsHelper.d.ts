import { AccountOp } from '../accountOp/accountOp';
import { PendingAmounts } from './interfaces';
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
export declare const calculatePendingAmounts: (latestAmount: bigint, pendingAmount: bigint, amountPostSimulation?: bigint, simulationDelta?: bigint, simulatedAccountOp?: AccountOp) => PendingAmounts | null;
//# sourceMappingURL=pendingAmountsHelper.d.ts.map