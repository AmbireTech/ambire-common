"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InviteController = exports.UNREACHABLE_MESSAGE = exports.INVALID_CODE_MESSAGE = exports.STATUS_WRAPPED_METHODS = exports.INVITE_STATUS = void 0;
const tslib_1 = require("tslib");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const relayerCall_1 = require("../../libs/relayerCall/relayerCall");
var INVITE_STATUS;
(function (INVITE_STATUS) {
    INVITE_STATUS["UNVERIFIED"] = "UNVERIFIED";
    INVITE_STATUS["VERIFIED"] = "VERIFIED";
})(INVITE_STATUS || (exports.INVITE_STATUS = INVITE_STATUS = {}));
exports.STATUS_WRAPPED_METHODS = {
    verify: 'INITIAL'
};
/** Shown when the relayer rejected the code, but did not say why. */
exports.INVALID_CODE_MESSAGE = "Oops, that code didn't work. Check for a typo and try again.";
/** Shown when the code never got a verdict, so it must not be blamed. */
exports.UNREACHABLE_MESSAGE = 'We could not check your code right now. Please check your connection and try again.';
/**
 * Prefers the explanation the relayer sent back, because it knows best why a code got rejected.
 * Anything that never got a verdict out of the relayer (no internet, a timeout, the relayer being
 * down) must not blame the code the user entered - it could be a perfectly valid one.
 */
const getVerifyErrorMessage = (error) => {
    const response = error?.output?.res;
    if (!response?.status ||
        response.status >= 500 ||
        // What the relayer call falls back to when the response body is not readable at all.
        response.message === relayerCall_1.RELAYER_DOWN_MESSAGE)
        return exports.UNREACHABLE_MESSAGE;
    // A rejected code comes back as a 200 with success: false and the reason at the top level.
    return response.message || exports.INVALID_CODE_MESSAGE;
};
const DEFAULT_STATE = {
    status: INVITE_STATUS.UNVERIFIED,
    verifiedAt: null,
    verifiedCode: null,
    becameOGAt: null
};
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
class InviteController extends eventEmitter_1.default {
    #storage;
    #callRelayer;
    #state = DEFAULT_STATE;
    statuses = exports.STATUS_WRAPPED_METHODS;
    /** Whether the invite gate has been passed. Only the mobile app enforces it. */
    inviteStatus = INVITE_STATUS.UNVERIFIED;
    /** Why the last verification failed, so that the screen can show it in the form itself. */
    errorMessage = '';
    /** The invite code the gate was passed with. The extension builds its analytics instance id from it. */
    verifiedCode = null;
    /**
     * Whether the user has become an Ambire OG (Original Gangster), a status that
     * comes with specific privileges (e.g. early access to new or experimental features).
     */
    isOG = false;
    /**
     * Whether the stored invite state has been read. The UI gates its own readiness on this flag,
     * because a state emitted before the load would show the gate to an already verified user.
     */
    isReady = false;
    #initialLoadPromise;
    constructor({ eventEmitterRegistry, relayerUrl, fetch, storage }) {
        super(eventEmitterRegistry);
        this.#storage = storage;
        this.#callRelayer = relayerCall_1.relayerCall.bind({ url: relayerUrl, fetch });
        this.#initialLoadPromise = this.#load().finally(() => {
            this.#initialLoadPromise = undefined;
        });
    }
    async #load() {
        const nextState = await this.#storage.get('invite', this.#state);
        this.#state = { ...DEFAULT_STATE, ...nextState };
        this.inviteStatus = this.#state.status;
        this.verifiedCode = this.#state.verifiedCode;
        this.isOG = !!this.#state.becameOGAt;
        this.isReady = true;
        this.emitUpdate();
    }
    async #persistVerified(code) {
        this.#state = {
            ...this.#state,
            status: INVITE_STATUS.VERIFIED,
            verifiedAt: Date.now(),
            verifiedCode: code
        };
        this.inviteStatus = this.#state.status;
        this.verifiedCode = this.#state.verifiedCode;
        this.emitUpdate();
        await this.#storage.set('invite', this.#state);
    }
    /** Verifies an invite code against the relayer and, if valid, passes the gate for good. */
    async verify(code) {
        await this.#initialLoadPromise;
        await this.withStatus('verify', async () => {
            try {
                await this.#callRelayer(`/promotions/extension-key/${code}`, 'GET');
            }
            catch (error) {
                this.errorMessage = getVerifyErrorMessage(error);
                this.emitUpdate();
                // Silent, because the message is displayed in the form, right below the code field,
                // instead of in a toast.
                throw new EmittableError_1.default({
                    message: this.errorMessage,
                    level: 'silent',
                    error,
                    sendCrashReport: false
                });
            }
            // Deliberately outside the try block, because the catch above always throws and blames the
            // code the user entered - a storage failure here must never be shown as a rejected code.
            this.errorMessage = '';
            await this.#persistVerified(code);
        });
    }
    /**
     * Passes the gate without asking the relayer, for everyone who was already using the app before
     * the gate got introduced - an app update must never lock them out. The caller passes the code
     * to record for them, so that their verified code is never blank.
     */
    async grantAccess(code) {
        await this.#initialLoadPromise;
        if (this.inviteStatus === INVITE_STATUS.VERIFIED)
            return;
        await this.#persistVerified(code);
    }
    /** Clears the last verification error, so that the form stops showing it. */
    resetErrorState() {
        this.errorMessage = '';
        this.emitUpdate();
    }
    async becomeOG() {
        await this.#initialLoadPromise;
        this.#state = { ...this.#state, becameOGAt: Date.now() };
        this.isOG = true;
        this.emitUpdate();
        await this.#storage.set('invite', this.#state);
    }
    async revokeOG() {
        await this.#initialLoadPromise;
        this.#state = { ...this.#state, becameOGAt: null };
        this.isOG = false;
        this.emitUpdate();
        await this.#storage.set('invite', this.#state);
    }
}
exports.InviteController = InviteController;
//# sourceMappingURL=invite.js.map