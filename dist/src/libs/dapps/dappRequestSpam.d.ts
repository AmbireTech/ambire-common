import { UserRequest } from '../../interfaces/userRequest';
/**
 * What we remember about one app while it keeps getting rejected.
 */
export interface DappSpamRecord {
    lastRejectedAt: number;
    rejectedCount: number;
    silencedAt: number | null;
}
/** A record for an app that has never been rejected. */
export declare const getEmptyDappSpamRecord: () => DappSpamRecord;
/**
 * The record after the user rejects one more request from the app. Rejections older than
 * the tracking window don't count, so an app the user refuses once in a while never
 * accumulates suspicion.
 */
export declare const recordRejection: (record: DappSpamRecord | undefined, now: number) => DappSpamRecord;
/**
 * Whether the app has been refused enough for the user to be offered a way to shut it up.
 * What the app asked for never comes into it: refusing the same request twice and refusing
 * two different ones weigh the same.
 */
export declare const shouldOfferSilence: (record: DappSpamRecord | undefined, now: number) => boolean;
/** Whether the app is still inside the quiet period the user put it in. */
export declare const isSilenced: (record: DappSpamRecord | undefined, now: number) => boolean;
/**
 * The apps a request came from, deduplicated. Usually one, but a transaction batch keyed by
 * account and chain collects calls from every app asking on that pair, so it can be several -
 * and an empty list for requests the wallet raised itself.
 */
export declare const getDappIdsFromUserRequest: (userRequest: UserRequest) => string[];
//# sourceMappingURL=dappRequestSpam.d.ts.map