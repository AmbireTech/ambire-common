import { Fetch } from '../../interfaces/fetch';
import { Storage } from '../../interfaces/storage';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare enum INVITE_STATUS {
    UNVERIFIED = "UNVERIFIED",
    VERIFIED = "VERIFIED"
}
type InviteState = {
    status: INVITE_STATUS;
    verifiedAt: null | number;
    verifiedCode: null | string;
    becameOGAt: null;
};
/**
 * As of v4.20.0, an invite verification flow is introduced as a first step upon
 * extension installation. This flow requires users to provide a valid invite
 * code before they can use the Ambire extension. This controller manages the
 * verification of these invite codes and persisting the current invite status.
 */
export declare class InviteController extends EventEmitter {
    #private;
    inviteStatus: InviteState['status'];
    verifiedCode: InviteState['verifiedCode'];
    /**
     * Whether the user has become an Ambire OG (Original Gangster), a status that
     * comes with specific privileges (e.g. early access to new or experimental features).
     */
    isOG: boolean;
    constructor({ relayerUrl, fetch, storage }: {
        relayerUrl: string;
        fetch: Fetch;
        storage: Storage;
    });
    /**
     * Verifies an invite code and if verified successfully, persists the invite
     * status (and some meta information) in the storage.
     */
    verify(code: string): Promise<void>;
    becomeOG(): Promise<void>;
    revokeOG(): Promise<void>;
}
export {};
//# sourceMappingURL=invite.d.ts.map