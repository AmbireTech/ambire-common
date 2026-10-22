import { SentToHistory } from '../../controllers/activity/types';
import { InternalAccountsOps } from '../../interfaces/activity';
/**
 * Record one recipient against an account, in place.
 *
 * Shared by ActivityController (on every broadcast) and the storage migration that seeds the
 * index from existing history, so the recency rule below has a single implementation.
 */
export declare function recordRecipient(history: SentToHistory, accountId: string, toAddress: string, toDomain: string | undefined, timestamp: number): void;
/**
 * Index every recipient in `ops` into `history`, in place. Stored ops without a list of calls are
 * skipped with a warning instead of throwing: this runs in a storage migration, and a throw there
 * skips every migration after it on every start.
 */
export declare function indexRecipientsFromOps(history: SentToHistory, ops: InternalAccountsOps): void;
//# sourceMappingURL=sentToHistory.d.ts.map