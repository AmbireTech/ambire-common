import { ISelectedAccountController } from '../../interfaces/selectedAccount';
import { IRecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout';
import { Session, SessionInitProps, SessionProp } from '../../classes/session';
import { ConnectionSource, Dapp, DappVerificationBanner, IDappsController, TrendingToken } from '../../interfaces/dapp';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { Fetch } from '../../interfaces/fetch';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Messenger } from '../../interfaces/messenger';
import { INetworksController } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { IStorageController } from '../../interfaces/storage';
import { IUiController } from '../../interfaces/ui';
import { UserRequest } from '../../interfaces/userRequest';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare class DappsController extends EventEmitter implements IDappsController {
    #private;
    static MAX_RECENT_DAPPS: number;
    dappSessions: {
        [sessionId: string]: Session;
    };
    dappToConnect: Dapp | null;
    isReadyToDisplayDapps: boolean;
    fetchAndUpdatePromise?: Promise<void>;
    get trendingTokens(): TrendingToken[];
    get trendingTokensUpdatedAt(): number | null;
    get shouldRetryFetchAndUpdate(): boolean;
    get retryFetchAndUpdateInterval(): IRecurringTimeout;
    get retryFetchAndUpdateAttempts(): number;
    initialLoadPromise?: Promise<void>;
    constructor({ eventEmitterRegistry, appVersion, fetch, storage, networks, phishing, ui, selectedAccount, featureFlags }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        appVersion: string;
        fetch: Fetch;
        storage: IStorageController;
        networks: INetworksController;
        phishing: IPhishingController;
        ui: IUiController;
        selectedAccount: ISelectedAccountController;
        featureFlags: IFeatureFlagsController;
    });
    /**
     * Not called immediately on construction because the data in storage is huge and overwhelming
     * for the mobile app.
     */
    init(): Promise<void>;
    get isReady(): boolean;
    get dapps(): Dapp[];
    get recentDapps(): Dapp[];
    get disguisedAsMetaMaskDappIds(): string[];
    get categories(): string[];
    fetchAndUpdateDapps(): Promise<void>;
    /**
     * Fetches, normalizes and persists the trending tokens. Throws on a failed fetch or a
     * malformed response so the caller can react (e.g. back off its retry cadence). Returns without
     * fetching when swap and bridge token info is disabled. The update interval and its lifecycle are
     * owned by the ContinuousUpdatesController.
     */
    updateTrendingTokens(): Promise<void>;
    getOrCreateDappSession({ windowId, tabId, url, wcTopic, frameId, topFrameUrl }: SessionInitProps): Promise<Session>;
    getDappSessionByWcTopic(wcTopic: string): Session | undefined;
    setSessionMessenger: (sessionId: string, messenger: Messenger, isAmbireNext: boolean) => void;
    setSessionLastHandledRequestsId: (sessionId: string, providerId: number, id: number, isWeb3AppRequest?: boolean) => void;
    resetSessionLastHandledRequestsId: (sessionId: string, providerId?: number) => void;
    setSessionProp: (sessionId: string, props: SessionProp) => void;
    deleteDappSession: (sessionId: string) => void;
    /**
     * Removes every session of a closed tab, including those of the iframes it hosted. Sessions are
     * only created by an incoming dApp request, so nothing recreates them for a tab that is gone.
     */
    deleteDappSessionsForTab: (tabId: number) => void;
    deleteDappSessionByWcTopic: (wcTopic: string) => void;
    /**
     * Removes a WalletConnect session terminated by the dApp and, once none of its WC sessions
     * remain, revokes the `'wc'` connection so the next pairing asks for approval again.
     */
    disconnectWcSessionByTopic: (wcTopic: string) => void;
    broadcastDappSessionEvent: (ev: any, data?: any, id?: string, skipPermissionCheck?: boolean, sourceFilter?: ConnectionSource) => Promise<void>;
    /**
     * Picks the best chainId for a WalletConnect dapp out of the chains it approved in its
     * eip155 namespace. WC sessions can approve multiple chains, and the chain the user is
     * actually transacting on is not necessarily the first one. Blindly taking `chains[0]`
     * (or hard-defaulting to mainnet) can strand the dapp on the wrong network, so prefer:
     *   1. the first approved chain that maps to an ENABLED wallet network,
     *   2. then the first approved chain that maps to any known wallet network,
     *   3. then the first approved chain as-is (so a not-yet-loaded custom network still
     *      round-trips its real chainId instead of being replaced by a default).
     * Returns `undefined` when there are no candidates, leaving the default handling to the caller.
     */
    pickWalletConnectChainId(candidateChainIds?: number[]): number | undefined;
    /**
     * Convenience for callers that have a dapp identity (id/url/name/icon) but not a full
     * Dapp record yet — used by the WalletConnect session setup/restore paths, which need
     * to register the dapp with `'wc'` as the source even when there's no prior catalog
     * entry. Defers to `#buildDapp` so existing catalog metadata is preserved.
     *
     * `candidateChainIds` are the chains the WC dapp approved in its eip155 namespace; the
     * dapp's stored chainId is resolved from them via `pickWalletConnectChainId`, falling
     * back to `identity.chainId` when no candidates are provided.
     */
    addDappFromIdentity(identity: {
        id: Dapp['id'];
        name: Dapp['name'];
        url: Dapp['url'];
        icon: Dapp['icon'];
        chainId?: Dapp['chainId'];
        candidateChainIds?: number[];
    }, source: ConnectionSource): Promise<void>;
    /**
     * Add a dapp and mark it connected via `source`. `source` defaults to `'injected'`
     * to keep the existing web/extension call sites (which don't know about sources)
     * behaving exactly as before. Calling `addDapp` again with a different source
     * appends it to `connectedSources` rather than overwriting.
     */
    addDapp(dapp: Dapp, source?: ConnectionSource): Promise<void>;
    updateDapp(id: string, dapp: Partial<Dapp>): void;
    updateDappToConnect(id: string, data: Partial<Dapp>): void;
    onSelectedAccountChange(newAccount: string): Promise<void>;
    /**
     * Tells every connected dapp that the wallet was unlocked. Each dapp receives only the
     * accounts it is allowed to see, never the accounts of another dapp.
     */
    broadcastUnlock(): Promise<void>;
    removeAccountData(address: string): void;
    /**
     * Disconnect a single connection source (e.g. only WalletConnect or only injected).
     * Broadcasts `disconnect` only to the sessions of that source. If no sources remain,
     * the dapp is fully disconnected (and removed if custom).
     */
    disconnectDappSource(id: string, source: ConnectionSource): Promise<void>;
    disconnectAllDapps(source?: ConnectionSource): Promise<Dapp[]>;
    removeDapp(id: string): void;
    addToRecentDapps(id: string): Promise<void>;
    clearRecentDapps(): Promise<void>;
    /**
     * Remembers that the user rejected a request this app sent. Only user-initiated rejections
     * belong here - the wallet's own auto-rejections must not count against the app.
     */
    recordDappRejection(id: string): void;
    /** One approved request clears all suspicion the app has accumulated. */
    clearDappRejections(id: string): void;
    shouldOfferToSilenceDapp(id: string): boolean;
    isDappSilenced(id: string): boolean;
    silenceDapp(id: string): void;
    hasPermission(id: string, source?: ConnectionSource): boolean;
    getDapp(id: string): Dapp;
    getDappByDomain(url: string): Dapp;
    isDappDisguisedAsMetaMask(id: string): boolean;
    setDappDisguisedAsMetaMask(id: string, isDisguisedAsMetaMask: boolean, requestId?: string): Promise<void>;
    /**
     * Marks the dApp at `url` as trusted, which silences the suspicious-hosting warning for it - and
     * for it alone. Takes the url rather than the id because the decision is made on the hostname.
     *
     * Refused for a dApp that shares its hostname with everything else published on the platform
     * (see canBeTrustedByUser); the UI hides the action there, but this is the check that counts.
     */
    trustDapp(url: string): Promise<void>;
    /** Revokes the trust the user gave a dApp, bringing its suspicious-hosting warning back. */
    untrustDapp(id: string): Promise<void>;
    /** Enables scam checking and immediately refreshes the pending connection request. */
    enableScamCheckerAndRefreshDappToConnect(): Promise<void>;
    setDappToConnectIfNeeded(currentRequest: UserRequest | null): Promise<void>;
    getCurrentDappAndSendResToUi({ requestId, dappId, currentSessionId }: {
        requestId: string;
        dappId: string;
        currentSessionId?: string;
    }): Promise<void>;
    protected hasUnverifiedDappUrls(dapps: string[]): boolean;
    hasUnverifiedDappsAndSendResToUi({ requestId, dapps }: {
        requestId: string;
        dapps: string[];
    }): Promise<void>;
    /**
     * True when the app is a default Ambire catalog entry - one we ship and keep an eye on - rather
     * than one the user added or connected to on their own. Used to decide how much to trust an app
     * beyond the verification status, e.g. whether to warn about an unlimited approval it requests.
     */
    isDappInDefaultCatalog(url: string): boolean;
    /**
     * True when the scam checker flags the app at `url`, or the page embedding it, as unsafe:
     * blacklisted, or hosted on a suspicious platform without the user having trusted it. Used to
     * keep auto-login away from such apps, since it signs without showing the warning. While the
     * scam checker is turned off nothing is flagged, so auto-login keeps working as usual.
     */
    isDappFlaggedAsUnsafe(url: string, sessionId?: string): boolean;
    /**
     * Returns the highest-priority dApp verification banner for the provided dApp URLs, or `null` if
     * the scam checker is disabled or no banner applies.
     *
     * Priority order:
     * 1) dApp is blacklisted (`BLACKLISTED`)
     * 2) dApp is hosted on a suspicious user-content platform (`SUSPICIOUS_HOSTING`)
     * 3) dApp verification in progress (`LOADING`)
     * 4) dApp verification failed / unknown (`FAILED_TO_GET` or missing status)
     * 5) dApp is verified but not in the default catalog
     *
     * Pass `includeDappNamesInText: false` in single-dApp flows (e.g. SignMessage),
     * where appending the dApp names in the banner text is redundant.
     */
    getDappVerificationBanner(dappUrls: string[], { includeDappNamesInText, sessionId }?: {
        includeDappNamesInText?: boolean;
        sessionId?: string;
    }): DappVerificationBanner | null;
    toJSON(): this & {
        dapps: Dapp[];
        recentDapps: Dapp[];
        disguisedAsMetaMaskDappIds: string[];
        categories: string[];
        dappToConnect: Dapp;
        isReady: boolean;
        trendingTokens: TrendingToken[];
        shouldRetryFetchAndUpdate: boolean;
        retryFetchAndUpdateInterval: IRecurringTimeout;
        retryFetchAndUpdateAttempts: number;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=dapps.d.ts.map