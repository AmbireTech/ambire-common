import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { Fetch } from '../../interfaces/fetch';
import { IInviteController } from '../../interfaces/invite';
import { IStorageController } from '../../interfaces/storage';
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
 * As of v5.1.0, invite code is no longer required for using the extension. In
 * v4.20.0, a mandatory invite verification flow is introduced as a first step
 * upon extension installation. The controller is still used to manage OG status
 * and other invite-related data.
 */
export declare class InviteController extends EventEmitter implements IInviteController {
    #private;
    inviteStatus: InviteState['status'];
    verifiedCode: InviteState['verifiedCode'];
    /**
     * Whether the user has become an Ambire OG (Original Gangster), a status that
     * comes with specific privileges (e.g. early access to new or experimental features).
     */
    isOG: boolean;
    constructor({ eventEmitterRegistry, relayerUrl, fetch, storage }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        relayerUrl: string;
        fetch: Fetch;
        storage: IStorageController;
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