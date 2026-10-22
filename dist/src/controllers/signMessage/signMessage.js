"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignMessageController = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const ExternalSignerError_1 = tslib_1.__importDefault(require("../../classes/ExternalSignerError"));
const safe_1 = require("../../consts/safe");
const dapp_1 = require("../../interfaces/dapp");
const signMessage_1 = require("../../interfaces/signMessage");
const helpers_1 = require("../../libs/dapps/helpers");
const humanizer_1 = require("../../libs/humanizer");
const helpers_2 = require("../../libs/safe/helpers");
const safe_2 = require("../../libs/safe/safe");
const signingRequest_1 = require("../../libs/signingRequest/signingRequest");
const signMessage_2 = require("../../libs/signMessage/signMessage");
const verifyMessage_1 = require("../../libs/signMessage/verifyMessage");
const hexStringToUint8Array_1 = tslib_1.__importDefault(require("../../utils/hexStringToUint8Array"));
const with_timeout_1 = require("../../utils/with-timeout");
const humanization_1 = tslib_1.__importDefault(require("../humanization/humanization"));
const STATUS_WRAPPED_METHODS = {
    sign: 'INITIAL'
};
class SignMessageController extends humanization_1.default {
    #keystore;
    #providers;
    networks;
    #externalSignerControllers;
    #accounts;
    #invite;
    #dapps;
    #erc7730;
    #platform;
    // Bumped when init() starts and whenever reset() is called; async operations
    // capture it and re-check after each await, so obsolete requests can't update
    // controller state or be signed under a previous approval.
    #signingGeneration = 0;
    signer;
    isInitialized = false;
    statuses = STATUS_WRAPPED_METHODS;
    dapp = null;
    messageToSign = null;
    humanizedMessage;
    isHumanizing = false;
    safeEip712Data = null;
    hardwareWalletSigningRequest = null;
    signedMessage = null;
    #account;
    network;
    // who are the signers that already signed this message
    // applicable on Safe message
    signed = [];
    // the already signed signatures
    // applicable on Safe message
    signatures = [];
    signers;
    /**
     * the signed hash
     */
    hash;
    status;
    constructor(keystore, providers, networks, accounts, externalSignerControllers, invite, eventEmitterRegistry, dapps, erc7730, platform) {
        super(eventEmitterRegistry);
        this.#keystore = keystore;
        this.#providers = providers;
        this.networks = networks;
        this.#externalSignerControllers = externalSignerControllers;
        this.#accounts = accounts;
        this.#invite = invite;
        this.#dapps = dapps;
        this.#erc7730 = erc7730;
        this.#platform = platform;
        this.status = signMessage_1.SignMessageStatus.Initial;
        // `banners` is derived from DappsController state (the dapp verification status), so its
        // updates must be propagated - otherwise a banner computed before the status resolves
        // (e.g. right after a service worker restart) would stay stale in the UI until this
        // controller happens to emit for another reason.
        // NOTE: No unsubscribe needed - both controllers are singletons living for the app lifetime.
        this.#dapps?.onUpdate((forceEmit) => {
            if (this.dapp?.url)
                this.propagateUpdate(forceEmit);
        }, 'sign-message-dapps-verification');
    }
    async init({ dapp, messageToSign, signed, hash, signatures }) {
        // In the unlikely case that the signMessage controller was already
        // initialized, but not reset, force reset it to prevent misleadingly
        // displaying the prev sign message request.
        if (this.isInitialized)
            this.reset();
        const initializationGeneration = ++this.#signingGeneration;
        await this.#accounts.initialLoadPromise;
        if (this.#signingGeneration !== initializationGeneration)
            return;
        if (['message', 'typedMessage', 'authorization-7702', 'siwe'].includes(messageToSign.content.kind)) {
            if (dapp)
                this.dapp = dapp;
            this.messageToSign = messageToSign;
            this.signed = signed || [];
            this.signatures = signatures || [];
            this.isInitialized = true;
            this.#account = this.#accounts.accounts.find((acc) => acc.addr === this.messageToSign?.accountAddr);
            if (!this.#account) {
                throw new Error('Account details needed for the signing mechanism are not found. Please try again, re-import your account or contact support if nothing else helps.');
            }
            this.network = this.networks.networks.find((n) => n.chainId === this.messageToSign.chainId);
            if (!this.network) {
                throw new Error('Network not supported on Ambire. Please contract support.');
            }
            const accountState = await this.#accounts.getOrFetchAccountOnChainState(this.#account.addr, this.network.chainId);
            if (this.#signingGeneration !== initializationGeneration)
                return;
            if (!accountState) {
                if (this.network.disabled) {
                    throw new Error(`Please enable ${this.network.name} from settings -> networks to sign messages on it`);
                }
                throw new Error(`Account details missing. Please try again`);
            }
            if (this.#account.safeCreation) {
                this.#updateSafeEip712Data();
                const notSigned = (0, safe_2.getImportedSignersThatHaveNotSigned)(this.signed, accountState.importedAccountKeys.map((k) => k.addr));
                if (this.signed.length && notSigned.length === 0)
                    this.status = signMessage_1.SignMessageStatus.Partial;
                this.hash = hash;
            }
            else {
                // if the account is not safe & view only, set a default signer
                // the default signer should be the internal key if any
                this.signers = accountState.importedAccountKeys
                    ? [
                        accountState.importedAccountKeys.find((k) => k.type === 'internal') ||
                            accountState.importedAccountKeys[0]
                    ]
                    : undefined;
            }
            this.emitUpdate();
            this.humanize();
        }
        else {
            this.emitError({
                level: 'major',
                message: 'Ambire does not support this request format for signing messages. Please contact support if you believe could be a glitch.',
                error: new Error(`The ${messageToSign.content.kind} signing method is not supported by signMessageController.`)
            });
        }
    }
    reset() {
        this.#signingGeneration += 1;
        this.stopHumanization();
        if (!this.isInitialized)
            return;
        this.#onAbortOperation();
        this.isInitialized = false;
        this.dapp = null;
        this.messageToSign = null;
        this.humanizedMessage = undefined;
        this.isHumanizing = false;
        this.safeEip712Data = null;
        this.hardwareWalletSigningRequest = null;
        this.signedMessage = null;
        this.#account = undefined;
        this.network = undefined;
        this.signed = [];
        this.signers = undefined;
        this.signer = undefined;
        this.status = signMessage_1.SignMessageStatus.Initial;
        this.emitUpdate();
    }
    #updateSafeEip712Data() {
        if (!this.#account?.safeCreation || !this.messageToSign || !this.network) {
            this.safeEip712Data = null;
            return;
        }
        const { content } = this.messageToSign;
        try {
            const message = content.kind === 'typedMessage' ? content : content.message;
            const typedData = (0, signMessage_2.getSafeMessageTypedData)(message, this.network.chainId, this.#account.addr);
            const safeMessageHash = (0, signMessage_2.getEIP712Hash)(typedData);
            this.safeEip712Data = (0, signingRequest_1.getSigningRequestDisplayData)((0, signingRequest_1.getEIP712SigningRequest)({ ...typedData, safeMessageHash }));
        }
        catch (error) {
            this.safeEip712Data = null;
            this.emitError({
                message: 'Error calculating Safe EIP-712 data',
                error: error instanceof Error ? error : new Error(String(error)),
                level: 'silent'
            });
        }
    }
    #setHardwareWalletSigningRequest(request) {
        let serializedRequestData = null;
        try {
            if (request)
                serializedRequestData = (0, signingRequest_1.getSigningRequestDisplayData)(request);
        }
        catch {
            serializedRequestData = null;
        }
        this.hardwareWalletSigningRequest =
            request && serializedRequestData !== null
                ? {
                    ...request,
                    data: serializedRequestData
                }
                : null;
        this.emitUpdate();
    }
    async #withHardwareWalletSigningRequest(request, sign) {
        this.#setHardwareWalletSigningRequest(request);
        try {
            return await sign();
        }
        finally {
            this.#setHardwareWalletSigningRequest(null);
        }
    }
    #startHumanization() {
        return this.startHumanization(() => {
            this.isHumanizing = true;
            this.humanizedMessage = undefined;
        });
    }
    #setHumanizedMessage(humanizedMessage, humanizationId) {
        if (!this.isCurrentHumanization(humanizationId))
            return false;
        this.humanizedMessage = humanizedMessage;
        this.isHumanizing = false;
        this.emitUpdate();
        return true;
    }
    #setFallbackHumanization(humanizationId) {
        if (!this.messageToSign)
            return false;
        return this.#setHumanizedMessage((0, humanizer_1.humanizeMessage)(this.messageToSign), humanizationId);
    }
    async #applyDescriptorFirstHumanization(humanizationId) {
        const messageToSign = this.messageToSign;
        const erc7730 = this.#erc7730;
        if (!messageToSign)
            return;
        // `Erc7730Controller` is the only route to a descriptor (it owns the relayer and the cache), so
        // its absence means clear signing is simply not available here - as in the auto-login flow,
        // which builds this controller without any relayer access at all.
        if (messageToSign.content.kind !== 'typedMessage' || !erc7730) {
            this.#setFallbackHumanization(humanizationId);
            return;
        }
        await this.applyDescriptorFirstHumanization({
            humanizationId,
            fetchDescriptor: async () => erc7730.getDescriptorForMessage(messageToSign),
            applyDescriptorHumanization: (erc7730Descriptor, currentHumanizationId) => {
                if (!erc7730Descriptor)
                    return false;
                const erc7730Humanization = (0, humanizer_1.humanizeMessage)(messageToSign, { erc7730Descriptor });
                return this.#setHumanizedMessage(erc7730Humanization, currentHumanizationId);
            },
            applyFallbackHumanization: (currentHumanizationId) => this.#setFallbackHumanization(currentHumanizationId)
        });
    }
    humanize() {
        if (!this.messageToSign)
            return;
        if (this.messageToSign.content.kind !== 'typedMessage' || !this.#erc7730) {
            const currentHumanizationId = this.#startHumanization();
            this.#setFallbackHumanization(currentHumanizationId);
            return;
        }
        const currentHumanizationId = this.#startHumanization();
        void this.#applyDescriptorFirstHumanization(currentHumanizationId);
    }
    update({ isAutoLoginEnabledByUser, autoLoginDuration }) {
        if (!this.isInitialized) {
            this.emitError({
                level: 'major',
                message: 'There was an error while updating the sign message request. Please try again.',
                error: new Error('signMessage: controller not initialized')
            });
            return;
        }
        if (this.messageToSign && this.messageToSign.content.kind === 'siwe') {
            if (typeof isAutoLoginEnabledByUser === 'boolean') {
                this.messageToSign.content.isAutoLoginEnabledByUser = !!isAutoLoginEnabledByUser;
            }
            if (typeof autoLoginDuration === 'number') {
                this.messageToSign.content.autoLoginDuration = autoLoginDuration;
            }
        }
        this.emitUpdate();
    }
    setSigners(signers) {
        this.signers = signers;
        this.emitUpdate();
    }
    /**
     * Checks if the signing operation is still valid after each async step, to guard
     * against a race condition where the operation is reset or the installed message is
     * replaced before the async operation is completed. The `signingGeneration` captured
     * at the start of the operation must still match, otherwise a same-kind request that
     * called init() mid-signing would get its payload signed under the previous approval.
     */
    #isSigningOperationValidAfterAsyncOperation(signingGeneration) {
        return (this.isInitialized && !!this.messageToSign && this.#signingGeneration === signingGeneration);
    }
    async addMsgToSafeGlobal(sig, message) {
        const network = this.network;
        const account = this.#account;
        if (!network || !account)
            return;
        // Attach the requesting dapp's name and url so the other owners can see the
        // request context when co-signing on a different device (see buildSafeMessageOrigin)
        const origin = (0, helpers_2.buildSafeMessageOrigin)(this.dapp);
        // send only to Safe Global if it doesn't already exists and if the threshold is not met
        await (0, with_timeout_1.withTimeout)(() => (0, safe_2.addMessage)(network.chainId, account.addr, message, sig, origin), {
            timeoutMs: safe_1.SAFE_API_TIMEOUT_MS,
            message: `Safe API: add message timed out after ${safe_1.SAFE_API_TIMEOUT_MS}ms`
        }).catch((e) => {
            console.log('failed to send message to Safe Global: ', e);
        });
    }
    async addSigToSafeGlobal(sig, hash) {
        const network = this.network;
        if (!network)
            return;
        await (0, with_timeout_1.withTimeout)(() => (0, safe_2.addMessageSignature)(network.chainId, hash, sig), {
            timeoutMs: safe_1.SAFE_API_TIMEOUT_MS,
            message: `Safe API: add message signature timed out after ${safe_1.SAFE_API_TIMEOUT_MS}ms`
        }).catch((e) => {
            console.log('failed to send message to Safe Global: ', e);
        });
    }
    /*
     * ⚠️ IMPORTANT: If you make changes here and they involve async operations,
     * make sure to check `isSigningOperationValidAfterAsyncOperation` afterwards
     * to ensure you’re not acting on obsolete data.
     */
    async #sign() {
        if (!this.isInitialized) {
            return SignMessageController.#throwNotInitialized();
        }
        if (!this.messageToSign) {
            return SignMessageController.#throwMissingMessage();
        }
        if (!this.signers?.length) {
            return SignMessageController.#throwMissingSigningKey();
        }
        // Bind this op to the current message; if init() replaces it during any
        // await below, the generation changes and the op aborts.
        const signingGeneration = this.#signingGeneration;
        // we're always signing with the first signer
        // the goal was to have an array of signers that sign simultaneously
        // but it was too confusing, so we threw it away
        // the array of signers should be changed back to a single signer
        const signerKey = this.signers[0];
        this.signer = await this.#keystore.getSigner(signerKey.addr, signerKey.type);
        if (this.signer.init) {
            this.signer.init(this.#externalSignerControllers[signerKey.type]);
        }
        this.emitUpdate(); // pass the signer to the UI
        try {
            if (!this.#isSigningOperationValidAfterAsyncOperation(signingGeneration))
                return;
            if (!this.#account) {
                throw new Error('Account details needed for the signing mechanism are not found. Please try again, re-import your account or contact support if nothing else helps.');
            }
            if (!this.network) {
                throw new Error('Network not supported on Ambire. Please contract support.');
            }
            const accountState = await this.#accounts.getOrFetchAccountOnChainState(this.#account.addr, this.network.chainId);
            if (!accountState) {
                throw new Error(`Account details missing. Please try again`);
            }
            const provider = this.#providers.providers[this.network.chainId.toString()];
            if (!provider)
                throw new Error(`Network details missing. Please try again`);
            let signature;
            try {
                if (this.messageToSign.content.kind === 'message' ||
                    this.messageToSign.content.kind === 'siwe') {
                    const signed = await (0, signMessage_2.getPlainTextSignature)(this.messageToSign.content.message, this.network, this.#account, accountState, this.signer, this.#invite.isOG, (request, sign) => this.#withHardwareWalletSigningRequest(request, sign), provider);
                    this.signatures.push(signed.signature);
                    this.signed.push(signerKey.addr);
                    if (accountState.threshold > 1) {
                        if (!!this.#account.safeCreation && signed.hash) {
                            this.hash = signed.hash;
                            if (this.signed.length === 1) {
                                await this.addMsgToSafeGlobal(signed.signature, (0, ethers_1.toUtf8String)(this.messageToSign.content.message));
                            }
                            else {
                                await this.addSigToSafeGlobal(signed.signature, signed.hash);
                            }
                        }
                    }
                    if (!this.#isSigningOperationValidAfterAsyncOperation(signingGeneration))
                        return;
                    // get the final signature
                    signature =
                        this.signatures.length === 1 || !signed.hash
                            ? this.signatures[0]
                            : (0, safe_2.sortSigs)(this.signatures, signed.hash);
                }
                if (this.messageToSign.content.kind === 'typedMessage') {
                    if ((0, signMessage_2.isCallToSelfOrAmbireOp)(this.messageToSign.content, this.#account)) {
                        throw new Error(signMessage_2.AMBIRE_OPERATION_SIGNING_NOT_ALLOWED_MESSAGE);
                    }
                    if (this.#account.creation && this.messageToSign.content.primaryType === 'Permit') {
                        throw new Error('It looks like that this app doesn\'t detect Smart Account wallets, and requested incompatible approval type. Please, go back to the app and change the approval type to "Transaction", which is supported by Smart Account wallets.');
                    }
                    const signed = await (0, signMessage_2.getEIP712Signature)(this.messageToSign.content, this.#account, accountState, this.signer, this.network, this.#invite.isOG, (request, sign) => this.#withHardwareWalletSigningRequest(request, sign), false, provider);
                    this.signatures.push(signed.signature);
                    this.signed.push(signerKey.addr);
                    if (accountState.threshold > 1) {
                        if (!!this.#account.safeCreation && signed.hash) {
                            this.hash = signed.hash;
                            if (this.signed.length === 1) {
                                await this.addMsgToSafeGlobal(signed.signature, this.messageToSign.content);
                            }
                            else {
                                await this.addSigToSafeGlobal(signed.signature, signed.hash);
                            }
                        }
                    }
                    if (!this.#isSigningOperationValidAfterAsyncOperation(signingGeneration))
                        return;
                    signature =
                        this.signatures.length === 1 || !signed.hash
                            ? this.signatures[0]
                            : (0, safe_2.sortSigs)(this.signatures, signed.hash);
                }
                if (this.messageToSign.content.kind === 'authorization-7702') {
                    // TODO: Deprecated. Sync with the latest sign7702 method changes if used
                    // signature = this.signer.sign7702(this.messageToSign.content.message)
                    throw new ExternalSignerError_1.default('Signing EIP-7702 authorization via this flow is not implemented', { sendCrashReport: true });
                }
            }
            catch (error) {
                throw new ExternalSignerError_1.default(error?.message ||
                    'Something went wrong while signing the message. Please try again later or contact support if the problem persists.', {
                    sendCrashReport: error?.sendCrashReport
                });
            }
            if (!signature) {
                throw new Error('Ambire was not able to retrieve the signature. Please try again or contact support if the problem persists.');
            }
            // skip the message verification for safe accounts & EOAs. Reasons:
            // * for EOAs: bcz it's a privacy issue
            // * for Safes: bcz the Safe API will return an error on invalid sig
            if (!this.#account.safeCreation && !accountState.isEOA) {
                const verifyMessageParams = {
                    provider,
                    // the signer is always the account even if the actual
                    // signature is from a key that has privs to the account
                    signer: this.messageToSign.accountAddr,
                    signature: (0, signMessage_2.getVerifyMessageSignature)(signature, this.#account, accountState),
                    ...(this.messageToSign.content.kind === 'message' ||
                        this.messageToSign.content.kind === 'siwe'
                        ? { message: (0, hexStringToUint8Array_1.default)(this.messageToSign.content.message) }
                        : this.messageToSign.content.kind === 'typedMessage'
                            ? {
                                typedData: {
                                    domain: this.messageToSign.content.domain,
                                    types: this.messageToSign.content.types,
                                    message: this.messageToSign.content.message,
                                    primaryType: this.messageToSign.content.primaryType
                                }
                            }
                            : {
                                authorization: this.messageToSign.content.message
                            })
                };
                const isValidSignature = await (0, verifyMessage_1.verifyMessage)(verifyMessageParams);
                if (!this.#isSigningOperationValidAfterAsyncOperation(signingGeneration))
                    return;
                if (!isValidSignature) {
                    throw new Error('Ambire failed to validate the signature. Please make sure you are signing with the correct key or device. If the problem persists, please contact Ambire support.');
                }
            }
            // A flagged app never gets an auto-login policy, whatever the toggle was left at
            if (this.messageToSign.content.kind === 'siwe' && this.isAutoLoginBlockedByScamChecker) {
                this.messageToSign.content.isAutoLoginEnabledByUser = false;
            }
            this.signedMessage = {
                ...this.messageToSign,
                timestamp: new Date().getTime(),
                // todo: configure
                signature: (0, signMessage_2.getAppFormatted)(signature, this.#account, accountState),
                dapp: this.dapp
            };
            // update the status to Partial if signing has not concluded
            this.status =
                this.signed.length >= accountState.threshold
                    ? signMessage_1.SignMessageStatus.Done
                    : signMessage_1.SignMessageStatus.Partial;
            return this.signedMessage;
        }
        catch (e) {
            const error = e instanceof Error ? e : new Error(`Signing failed. Error details: ${e}`);
            const message = e?.message || 'Something went wrong while signing the message. Please try again.';
            return Promise.reject(new EmittableError_1.default({
                level: 'major',
                message,
                error,
                sendCrashReport: e?.sendCrashReport
            }));
        }
    }
    async sign() {
        await this.withStatus('sign', async () => this.#sign());
    }
    removeAccountData(address) {
        if (this.messageToSign?.accountAddr.toLowerCase() === address.toLowerCase()) {
            this.reset();
        }
    }
    /**
     * Unbrick mechanism.
     * Use this only when you are sure there's no way to continue, or
     * a promise waiting to resolve that might change the state
     */
    cancelSignReq() {
        this.statuses.sign = 'INITIAL';
        this.hardwareWalletSigningRequest = null;
        this.emitUpdate();
    }
    #onAbortOperation() {
        if (this.signer?.signingCleanup) {
            void this.signer.signingCleanup();
        }
    }
    static #throwNotInitialized() {
        const message = 'Looks like there is an error while processing your sign message. Please retry, or contact support if issue persists.';
        const error = new Error('signMessage: controller not initialized');
        return Promise.reject(new EmittableError_1.default({ level: 'major', message, error }));
    }
    static #throwMissingMessage() {
        const message = 'Looks like there is an error while processing your sign message. Please retry, or contact support if issue persists.';
        const error = new Error('signMessage: missing message to sign');
        return Promise.reject(new EmittableError_1.default({ level: 'major', message, error }));
    }
    static #throwMissingSigningKey() {
        const message = 'Please select a signer.';
        const error = new Error('signMessage: missing selected signer');
        return Promise.reject(new EmittableError_1.default({ level: 'major', message, error }));
    }
    #getDappVerificationBanner() {
        if (!this.#dapps || !this.dapp?.url)
            return null;
        const banner = this.#dapps.getDappVerificationBanner([this.dapp.url.toLowerCase()], {
            // SignMessage operates on a single dApp, and the request window already shows it,
            // so repeating the dApp name in the banner text adds noise.
            includeDappNamesInText: false,
            sessionId: this.dapp.sessionId
        });
        if (!banner)
            return null;
        // In the SignMessage flow, "not in catalog" is too noisy and not actionable enough on its own.
        if (banner.id === dapp_1.DAPP_VERIFICATION_BANNER_IDS.NOT_IN_CATALOG)
            return null;
        return banner;
    }
    get banners() {
        const banner = this.#getDappVerificationBanner();
        if (!banner)
            return [];
        return [banner];
    }
    /**
     * Whether auto-login can't be turned on for the requesting app, because the scam checker flags
     * it as unsafe. Clears as soon as the user trusts the app from the warning.
     */
    get isAutoLoginBlockedByScamChecker() {
        if (!this.#dapps || !this.dapp?.url)
            return false;
        return this.#dapps.isDappFlaggedAsUnsafe(this.dapp.url.toLowerCase(), this.dapp.sessionId);
    }
    /**
     * Why this message needs the password/biometrics confirmation, or `null` when it does not. Only
     * a dapp the catalog knows can require it - elsewhere the confirmation cannot be remembered.
     * Mobile only. A Safe needs it only when its hot owners can meet the threshold on their own.
     */
    get signingAuthRequirement() {
        const dapps = this.#dapps;
        if (!(0, helpers_1.isSigningAuthPlatform)(this.#platform) || !dapps || !this.dapp?.url)
            return null;
        if (this.#account?.safeCreation && this.messageToSign) {
            const accountState = this.#accounts.accountStates[this.#account.addr]?.[this.messageToSign.chainId.toString()];
            // A state that is not loaded yet falls through to the dapp check, so it never skips the prompt
            if (accountState &&
                !(0, safe_2.canHotOwnersMeetSafeThreshold)(accountState.importedAccountKeys, accountState.threshold))
                return null;
        }
        // Looked up by dapp id, which is what dapps are stored under - looking up by the registrable
        // domain silently found nothing for every dapp on a subdomain
        const unauthenticatedDapps = (0, helpers_1.getUnauthenticatedDapps)([
            dapps.getDapp((0, helpers_1.getDappIdFromUrl)(this.dapp.url))
        ]);
        if (!unauthenticatedDapps.length)
            return null;
        return { firstTimeRecipients: [], unauthenticatedDapps };
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            banners: this.banners,
            isAutoLoginBlockedByScamChecker: this.isAutoLoginBlockedByScamChecker,
            signingAuthRequirement: this.signingAuthRequirement
        };
    }
}
exports.SignMessageController = SignMessageController;
//# sourceMappingURL=signMessage.js.map