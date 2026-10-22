"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDappIdsFromUserRequest = exports.isSilenced = exports.shouldOfferSilence = exports.recordRejection = exports.getEmptyDappSpamRecord = void 0;
const dappRequestSpam_1 = require("../../consts/safeguards/dappRequestSpam");
/** A record for an app that has never been rejected. */
const getEmptyDappSpamRecord = () => ({
    lastRejectedAt: 0,
    rejectedCount: 0,
    silencedAt: null
});
exports.getEmptyDappSpamRecord = getEmptyDappSpamRecord;
/**
 * The record after the user rejects one more request from the app. Rejections older than
 * the tracking window don't count, so an app the user refuses once in a while never
 * accumulates suspicion.
 */
const recordRejection = (record, now) => {
    const isWithinWindow = !!record && now - record.lastRejectedAt < dappRequestSpam_1.DAPP_REJECT_TRACKING_WINDOW;
    if (!isWithinWindow) {
        return {
            ...(0, exports.getEmptyDappSpamRecord)(),
            // The quiet period is the user's own decision and outlives the counters that led to it
            silencedAt: record?.silencedAt ?? null,
            lastRejectedAt: now,
            rejectedCount: 1
        };
    }
    return {
        ...record,
        lastRejectedAt: now,
        rejectedCount: record.rejectedCount + 1
    };
};
exports.recordRejection = recordRejection;
/**
 * Whether the app has been refused enough for the user to be offered a way to shut it up.
 * What the app asked for never comes into it: refusing the same request twice and refusing
 * two different ones weigh the same.
 */
const shouldOfferSilence = (record, now) => {
    if (!record)
        return false;
    if (now - record.lastRejectedAt >= dappRequestSpam_1.DAPP_REJECT_TRACKING_WINDOW)
        return false;
    return record.rejectedCount >= dappRequestSpam_1.DAPP_REJECTS_BEFORE_OFFERING_SILENCE;
};
exports.shouldOfferSilence = shouldOfferSilence;
/** Whether the app is still inside the quiet period the user put it in. */
const isSilenced = (record, now) => {
    if (!record?.silencedAt)
        return false;
    return now - record.silencedAt < dappRequestSpam_1.DAPP_SILENCE_DURATION;
};
exports.isSilenced = isSilenced;
/**
 * The apps a request came from, deduplicated. Usually one, but a transaction batch keyed by
 * account and chain collects calls from every app asking on that pair, so it can be several -
 * and an empty list for requests the wallet raised itself.
 */
const getDappIdsFromUserRequest = (userRequest) => {
    const ids = userRequest.dappPromises.map((p) => p.session?.id).filter(Boolean);
    return [...new Set(ids)];
};
exports.getDappIdsFromUserRequest = getDappIdsFromUserRequest;
//# sourceMappingURL=dappRequestSpam.js.map