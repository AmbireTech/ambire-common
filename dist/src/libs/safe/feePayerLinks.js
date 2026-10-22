"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSafeFeePayerRank = getSafeFeePayerRank;
exports.isUnlinkedSafeFeePayer = isUnlinkedSafeFeePayer;
/**
 * Rank of an account paying a Safe's fee, lower is better: the last payer first, then the
 * owners, then the other payers already linked to the Safe, then the rest, which would get
 * publicly linked to it by paying.
 */
function getSafeFeePayerRank(paidBy, links) {
    const paidByLowercased = paidBy.toLowerCase();
    if (links.lastUsed === paidByLowercased)
        return 0;
    if (links.owners.includes(paidByLowercased))
        return 1;
    if (links.linked.includes(paidByLowercased))
        return 2;
    return 3;
}
/**
 * Whether paying a Safe's fee from `paidBy` would publicly link a new account to the Safe.
 * The Safe paying by itself (e.g. through the gas tank) links nothing.
 */
function isUnlinkedSafeFeePayer(paidBy, safeAddr, links) {
    if (paidBy.toLowerCase() === safeAddr.toLowerCase())
        return false;
    return getSafeFeePayerRank(paidBy, links) === 3;
}
//# sourceMappingURL=feePayerLinks.js.map