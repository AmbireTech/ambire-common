import EventEmitter from '../eventEmitter/eventEmitter';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { Fetch } from '../../interfaces/fetch';
import { IInviteController } from '../../interfaces/invite';
import { IStorageController } from '../../interfaces/storage';
export declare enum INVITE_STATUS {
    UNVERIFIED = "UNVERIFIED",
    VERIFIED = "VERIFIED"
}
export declare const STATUS_WRAPPED_METHODS: {
    readonly verify: "INITIAL";
};
type InviteState = {
    status: INVITE_STATUS;
    verifiedAt: null | number;
    verifiedCode: null | string;
    becameOGAt: null | number;
};
/** Shown when the relayer rejected the code, but did not say why. */
export declare const INVALID_CODE_MESSAGE = "Oops, that code didn't work. Check for a typo and try again.";
/** Shown when the code never got a verdict, so it must not be blamed. */
export declare const UNREACHABLE_MESSAGE = "We could not check your code right now. Please check your connection and try again.";
/**
 * Manages the invite gate and the OG status.
 *
 * The gate was mandatory for the extension between v4.20.0 and v5.1.0, and is mandatory for the
 * mobile app as of the mobile v6 series release since v6.21.0. Both use the same Relayer endpoint
 * and the same `invite` storage entry, so verifying is one and the same mechanism - the only
 * difference is that the extension no longer enforces it.
 *
 * The controller is platform-agnostic on purpose - it only stores and verifies. Whether the gate
 * is enforced at all is decided by the router of the app using it.
 */
export declare class InviteController extends EventEmitter implements IInviteController {
    #private;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    /** Whether the invite gate has been passed. Only the mobile app enforces it. */
    inviteStatus: InviteState['status'];
    /** Why the last verification failed, so that the screen can show it in the form itself. */
    errorMessage: string;
    /** The invite code the gate was passed with. The extension builds its analytics instance id from it. */
    verifiedCode: InviteState['verifiedCode'];
    /**
     * Whether the user has become an Ambire OG (Original Gangster), a status that
     * comes with specific privileges (e.g. early access to new or experimental features).
     */
    isOG: boolean;
    /**
     * Whether the stored invite state has been read. The UI gates its own readiness on this flag,
     * because a state emitted before the load would show the gate to an already verified user.
     */
    isReady: boolean;
    constructor({ eventEmitterRegistry, relayerUrl, fetch, storage }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        relayerUrl: string;
        fetch: Fetch;
        storage: IStorageController;
    });
    /** Verifies an invite code against the relayer and, if valid, passes the gate for good. */
    verify(code: string): Promise<void>;
    /**
     * Passes the gate without asking the relayer, for everyone who was already using the app before
     * the gate got introduced - an app update must never lock them out. The caller passes the code
     * to record for them, so that their verified code is never blank.
     */
    grantAccess(code: string): Promise<void>;
    /** Clears the last verification error, so that the form stops showing it. */
    resetErrorState(): void;
    becomeOG(): Promise<void>;
    revokeOG(): Promise<void>;
}
export {};
//# sourceMappingURL=invite.d.ts.map