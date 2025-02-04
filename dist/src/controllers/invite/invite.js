import { relayerCall } from '../../libs/relayerCall/relayerCall';
import EventEmitter from '../eventEmitter/eventEmitter';
// eslint-disable-next-line @typescript-eslint/naming-convention
export var INVITE_STATUS;
(function (INVITE_STATUS) {
    INVITE_STATUS["UNVERIFIED"] = "UNVERIFIED";
    INVITE_STATUS["VERIFIED"] = "VERIFIED";
})(INVITE_STATUS || (INVITE_STATUS = {}));
const DEFAULT_STATE = {
    status: INVITE_STATUS.UNVERIFIED,
    verifiedAt: null,
    verifiedCode: null,
    becameOGAt: null
};
/**
 * As of v4.20.0, an invite verification flow is introduced as a first step upon
 * extension installation. This flow requires users to provide a valid invite
 * code before they can use the Ambire extension. This controller manages the
 * verification of these invite codes and persisting the current invite status.
 */
export class InviteController extends EventEmitter {
    #storage;
    #callRelayer;
    #state = DEFAULT_STATE;
    inviteStatus = INVITE_STATUS.UNVERIFIED;
    verifiedCode = null;
    /**
     * Whether the user has become an Ambire OG (Original Gangster), a status that
     * comes with specific privileges (e.g. early access to new or experimental features).
     */
    isOG = false;
    #initialLoadPromise;
    constructor({ relayerUrl, fetch, storage }) {
        super();
        this.#storage = storage;
        this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch });
        this.#initialLoadPromise = this.#load();
    }
    async #load() {
        const nextState = await this.#storage.get('invite', this.#state);
        this.#state = { ...DEFAULT_STATE, ...nextState };
        this.inviteStatus = this.#state.status;
        this.verifiedCode = this.#state.verifiedCode;
        this.isOG = !!this.#state.becameOGAt;
        this.emitUpdate();
    }
    /**
     * Verifies an invite code and if verified successfully, persists the invite
     * status (and some meta information) in the storage.
     */
    async verify(code) {
        await this.#initialLoadPromise;
        try {
            const res = await this.#callRelayer(`/promotions/extension-key/${code}`, 'GET');
            if (!res.success)
                throw new Error(res.message || "Couldn't verify the invite code");
            this.inviteStatus = INVITE_STATUS.VERIFIED;
            this.verifiedCode = code;
            this.emitUpdate();
            const verifiedAt = Date.now();
            await this.#storage.set('invite', {
                ...this.#state,
                status: INVITE_STATUS.VERIFIED,
                verifiedAt,
                verifiedCode: code
            });
        }
        catch (error) {
            this.emitError(error);
        }
    }
    async becomeOG() {
        await this.#initialLoadPromise;
        const becameOGAt = Date.now();
        await this.#storage.set('invite', { ...this.#state, becameOGAt });
        this.isOG = true;
        this.emitUpdate();
    }
    async revokeOG() {
        await this.#initialLoadPromise;
        await this.#storage.set('invite', { ...this.#state, becameOGAt: null });
        this.isOG = false;
        this.emitUpdate();
    }
}
//# sourceMappingURL=invite.js.map