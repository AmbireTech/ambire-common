"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordFeePayer = recordFeePayer;
const getAddressCaught_1 = require("../../utils/getAddressCaught");
/**
 * Record, in place, that `paidBy` paid the fee for a transaction of `accountId` on `chainId`
 * at `timestamp`, keeping the latest payment of each payer. Payments made by the account itself
 * (e.g. gas tank or its own balance) link nothing new, so they are skipped.
 * Returns whether the history changed, so callers persist only then.
 */
function recordFeePayer(history, accountId, chainId, paidBy, timestamp) {
    const checksummedPaidBy = paidBy ? (0, getAddressCaught_1.getAddressCaught)(paidBy) : null;
    const checksummedAccountId = (0, getAddressCaught_1.getAddressCaught)(accountId);
    if (!checksummedPaidBy || !checksummedAccountId)
        return false;
    if (checksummedPaidBy === checksummedAccountId)
        return false;
    const chainIdKey = chainId.toString();
    if (!history[checksummedAccountId])
        history[checksummedAccountId] = {};
    const payers = history[checksummedAccountId][chainIdKey] || {};
    const lastPaidAt = payers[checksummedPaidBy];
    if (lastPaidAt !== undefined && lastPaidAt >= timestamp)
        return false;
    history[checksummedAccountId][chainIdKey] = { ...payers, [checksummedPaidBy]: timestamp };
    return true;
}
//# sourceMappingURL=feePayersHistory.js.map