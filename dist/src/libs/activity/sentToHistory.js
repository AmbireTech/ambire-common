"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordRecipient = recordRecipient;
exports.indexRecipientsFromOps = indexRecipientsFromOps;
const getAddressCaught_1 = require("../../utils/getAddressCaught");
const submittedAccountOp_1 = require("../accountOp/submittedAccountOp");
/**
 * Record one recipient against an account, in place.
 *
 * Shared by ActivityController (on every broadcast) and the storage migration that seeds the
 * index from existing history, so the recency rule below has a single implementation.
 */
function recordRecipient(history, accountId, toAddress, toDomain, timestamp) {
    const checksummedAddress = (0, getAddressCaught_1.getAddressCaught)(toAddress);
    if (!checksummedAddress)
        return;
    if (!history.recipients[accountId])
        history.recipients[accountId] = {};
    const existing = history.recipients[accountId][checksummedAddress] || 0;
    history.recipients[accountId][checksummedAddress] = Math.max(existing, timestamp);
    const normalized = toDomain?.toLowerCase().trim();
    if (!normalized)
        return;
    // Keep the newest: the migration walks history out of order, so last-write-wins could point
    // a domain at an older address — feeding a wrong "previous address" to the send-screen
    // domain-change warning.
    const existingDomain = history.domains[normalized];
    if (existingDomain && existingDomain.sentAt > timestamp)
        return;
    history.domains[normalized] = { address: checksummedAddress, sentAt: timestamp };
}
/**
 * Index every recipient in `ops` into `history`, in place. Stored ops without a list of calls are
 * skipped with a warning instead of throwing: this runs in a storage migration, and a throw there
 * skips every migration after it on every start.
 */
function indexRecipientsFromOps(history, ops) {
    let skippedOpsCount = 0;
    for (const [accountAddr, byChain] of Object.entries(ops)) {
        for (const groupOps of Object.values(byChain)) {
            for (const op of groupOps ?? []) {
                if (!Array.isArray(op?.calls)) {
                    skippedOpsCount++;
                    continue;
                }
                (0, submittedAccountOp_1.getAccountOpRecipients)(op).forEach((recipient) => recordRecipient(history, accountAddr, recipient.address, recipient.domain, op.timestamp));
            }
        }
    }
    if (skippedOpsCount)
        console.warn(`indexRecipientsFromOps: skipped ${skippedOpsCount} stored ops without calls`);
}
//# sourceMappingURL=sentToHistory.js.map