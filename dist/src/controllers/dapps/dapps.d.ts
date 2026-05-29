import { IRecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout';
import { Session, SessionInitProps, SessionProp } from '../../classes/session';
import { ConnectionSource, Dapp, DappVerificationBanner, IDappsController } from '../../interfaces/dapp';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { Fetch } from '../../interfaces/fetch';
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
    get shouldRetryFetchAndUpdate(): boolean;
    get retryFetchAndUpdateInterval(): IRecurringTimeout;
    get retryFetchAndUpdateAttempts(): number;
    initialLoadPromise?: Promise<void>;
    constructor({ eventEmitterRegistry, appVersion, fetch, storage, networks, phishing, ui }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        appVersion: string;
        fetch: Fetch;
        storage: IStorageController;
        networks: INetworksController;
        phishing: IPhishingController;
        ui: IUiController;
    });
    get isReady(): boolean;
    get dapps(): Dapp[];
    get recentDapps(): Dapp[];
    get categories(): string[];
    fetchAndUpdateDapps(): Promise<void>;
    getOrCreateDappSession({ windowId, tabId, url, wcTopic }: SessionInitProps): Promise<Session>;
    getDappSessionByWcTopic(wcTopic: string): Session | undefined;
    setSessionMessenger: (sessionId: string, messenger: Messenger, isAmbireNext: boolean) => void;
    setSessionLastHandledRequestsId: (sessionId: string, providerId: number, id: number, isWeb3AppRequest?: boolean) => void;
    resetSessionLastHandledRequestsId: (sessionId: string, providerId?: number) => void;
    setSessionProp: (sessionId: string, props: SessionProp) => void;
    deleteDappSession: (sessionId: string) => void;
    deleteDappSessionByWcTopic: (wcTopic: string) => void;
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
    /**
     * Disconnect a single connection source (e.g. only WalletConnect or only injected).
     * Broadcasts `disconnect` only to the sessions of that source. If no sources remain,
     * the dapp is fully disconnected (and removed if custom).
     */
    disconnectDappSource(id: string, source: ConnectionSource): Promise<void>;
    removeDapp(id: string): void;
    addToRecentDapps(id: string): Promise<void>;
    clearRecentDapps(): Promise<void>;
    hasPermission(id: string, source?: ConnectionSource): boolean;
    getDapp(id: string): Dapp;
    getDappByDomain(url: string): Dapp;
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
     * Returns the highest-priority dApp verification banner for the provided dApp URLs, or `null` if none apply.
     *
     * Priority order:
     * 1) dApp verification in progress (`LOADING`)
     * 2) dApp verification failed / unknown (`FAILED_TO_GET` or missing status)
     * 3) dApp is blacklisted (`BLACKLISTED`)
     * 4) dApp is verified but not in the default catalog
     *
     * Pass `includeDappNamesInText: false` in single-dApp flows (e.g. SignMessage),
     * where appending the dApp names in the banner text is redundant.
     */
    getDappVerificationBanner(dappUrls: string[], { includeDappNamesInText }?: {
        includeDappNamesInText?: boolean;
    }): DappVerificationBanner | null;
    toJSON(): this & {
        dapps: Dapp[];
        recentDapps: Dapp[];
        categories: string[];
        isReady: boolean;
        shouldRetryFetchAndUpdate: boolean;
        retryFetchAndUpdateInterval: IRecurringTimeout;
        retryFetchAndUpdateAttempts: number;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=dapps.d.ts.map