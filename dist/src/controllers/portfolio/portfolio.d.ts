import { Account, AccountId, AccountOnchainState, IAccountsController } from '../../interfaces/account';
import { IBannerController } from '../../interfaces/banner';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Fetch } from '../../interfaces/fetch';
import { IKeystoreController } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { Platform } from '../../interfaces/platform';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IProvidersController, RPCProviders } from '../../interfaces/provider';
import { IStorageController } from '../../interfaces/storage';
import { IUiController } from '../../interfaces/ui';
import { IVerificationController } from '../../interfaces/verification';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { NetworksWithPositions, PositionCountOnDisabledNetworks } from '../../libs/defiPositions/types';
import { Portfolio } from '../../libs/portfolio';
import { CustomToken, TokenPreference } from '../../libs/portfolio/customToken';
import { PortfolioDebugFlow } from '../../libs/portfolio/debug';
import { AccountAssetsState, AccountState, ExchangeInfoMap, FormattedPortfolioDiscoveryResponse, GetOptions, TemporaryTokens, TokenDataCache, TokenError, AssetValidations, TokenResult } from '../../libs/portfolio/interfaces';
import batcher from '../../utils/batcher';
import EventEmitter from '../eventEmitter/eventEmitter';
import { HintsController } from '../hintsController/hintsController';
export declare const EXCHANGE_LIST_URL = "https://cena.ambire.com/api/v3/exchanges";
/**
 * The portfolio controller is responsible for managing and updating the portfolio state.
 * The portfolio state is divided by account and network. Every network's state
 * contains the tokens, NFTs and DeFi positions for the account on that network.
 *
 * Short glossary:
 * - Deployless - a library used by the portfolio library to fetch token and NFT information. It's
 * also used to fetch custom defi positions, account state etc. (in other places)
 * - Portfolio library - fetches tokens and NFTs using deployless and also makes a call for
 * prices.
 * - Hints - list of token and NFT addresses that are likely to be owned by the user.
 *
 * How it works:
 * - A call is made to Velcro to fetch hints and defi positions.
 * - Using the hints, the portfolio library is called to fetch tokens and NFTs.
 * - Parallel with the portfolio library call, deployless is used to fetch custom defi positions.
 * - Once all data is fetched, it's combined and the state is updated.
 * - As the custom defi positions may contain tokens that weren't in the hints and weren't fetched
 * by the portfolio library we add them in a hackish way to the state. On subsequent updates
 * the portfolio library receives them as hints and they are learned properly.
 *
 * Other concepts:
 * - Temporary tokens - tokens that are fetched on demand so they can be displayed in the UI.
 * As the name suggests, they are temporary and used for things like displaying a token's information
 * before being added as custom.
 * - To be learned tokens - tokens added from sources like swapAndBridge, activity, the humanizer. Some of them
 * may be owned by the user in the near future (e.g. the user swapped a token and will receive it soon).
 * - App defi positions - defi positions that are not linked to a specific network and have a slightly different structure (no addresses for assets). They are
 * fetched separately, but batched together with all other calls to the external API. (e.g, Polymarket and Hyperliquid positions)
 *
 * Hints sources:
 * - Velcro, existing defi positions, learned assets, toBeLearnedAssets, custom tokens
 * - On manual updates, learned tokens of other accounts are also used to discover new assets
 */
export declare class PortfolioController extends EventEmitter<PortfolioDebugFlow> implements IPortfolioController {
    #private;
    validTokens: AssetValidations;
    temporaryTokens: TemporaryTokens;
    hasFundedHotAccount: boolean;
    protected batchedPortfolioDiscovery: ReturnType<typeof batcher>;
    protected tokenDataCache: {
        [chainId: string]: TokenDataCache;
    };
    /**
     * Handles token learning, temporary tokens, hints and their storage.
     */
    protected hints: HintsController;
    initialLoadPromise?: Promise<void>;
    /**
     * When the exchange list was last loaded, or null before that. Lets the UI look up
     * exchanges again once the list arrives, without the list itself being public.
     */
    exchangeListUpdatedAt: number | null;
    constructor(storage: IStorageController, fetch: Fetch, providers: IProvidersController, networks: INetworksController, accounts: IAccountsController, keystore: IKeystoreController, relayerUrl: string, velcroUrl: string, banner: IBannerController, featureFlags: IFeatureFlagsController, ui: IUiController, eventEmitterRegistry?: IEventEmitterRegistryController, verification?: IVerificationController, platform?: Platform);
    updateExchangeList(): Promise<void>;
    /**
     * Looks up the display info of the given exchanges. Unknown ids are left out, and the
     * result is empty until the exchange list has loaded.
     */
    getExchangesInfo(exchangeIds: string[]): ExchangeInfoMap;
    /** Replies to a UI request with {@link getExchangesInfo} for the given exchanges. */
    getExchangesInfoAndSendResToUi(exchangeIds: string[], requestId: string): void;
    /** The account's invite key for the Ambire Mobile app, or undefined if it has none. */
    getMobileInviteKey(accountAddr: string): string | undefined;
    /**
     * The account's DeFi position counts on networks the user has disabled. Empty until a
     * full update across all networks has completed.
     */
    getDefiPositionsCountOnDisabledNetworks(accountAddr: string): PositionCountOnDisabledNetworks[string];
    private fetchBlacklist;
    private get blacklist();
    addCustomToken(customToken: CustomToken, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    removeCustomToken(customToken: Omit<CustomToken, 'standard'>, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    toggleHideToken(tokenPreference: TokenPreference, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    get customTokens(): CustomToken[];
    get tokenPreferences(): TokenPreference[];
    addTokensToBeLearned(tokenAddresses: string[], chainId: bigint): boolean;
    addErc721sToBeLearned(nftsData: [string, bigint[]][] | undefined, accountAddr: string, chainId: bigint): boolean;
    removeNetworkData(chainId: bigint): void;
    /**
     * Removes simulation results from the portfolio state. This function is used when
     * all simulated account ops should be discarded for a network-account pair. It does
     * not update the portfolio but simply removes the simulation results from the state.
     *
     * If you instead need to remove a specific accountOp from the simulation results, use `discardSimulation`
     * (e.g., after an account op is broadcasted and confirmed)
     *
     * If possible, this method shouldn't be awaited as we run the
     * risks of slowing the extension down unintentionally
     */
    overrideSimulationResults(accountOp: AccountOp): Promise<void>;
    /**
     * Used to schedule portfolio updates for a specific account and network. Atm it's only used to
     * update the portfolio after an interval from the last transaction, so we are sure that potential changes
     * to defi positions have been indexed by our discovery API
     */
    scheduleUpdate({ accountId, chainId, bypassServerSideCache }: {
        accountId: AccountId;
        chainId: bigint;
        bypassServerSideCache: true;
    }): void;
    /**
     * The chains with a portfolio update queued or in flight after a recent transaction, by account.
     * Read by the UI to tell the user their defi positions are about to refresh.
     */
    get scheduledUpdateChainIds(): {
        [accountId: string]: bigint[];
    };
    /**
     * Removes a specific simulated account op from the portfolio state and updates
     * the portfolio for the corresponding account and networks.
     *
     * The function protects against race conditions by removing specific accountOps
     *
     * Example usage: after an account op is broadcasted and confirmed
     */
    discardSimulation(accountOps: AccountOp[]): Promise<void>;
    updateTokenValidationByStandard(token: {
        address: TokenResult['address'];
        chainId: TokenResult['chainId'];
    }, accountId: AccountId, allNetworks?: boolean): Promise<void>;
    /**
     * Validates that the address is an ERC-721 collection before it's added as a
     * custom one and stores the result in `validTokens.erc721`.
     *
     * `shouldRefetch` runs the check again for an address that already has a
     * verdict, which the UI asks for after a network problem.
     */
    updateCollectionValidation(collection: {
        address: TokenResult['address'];
        chainId: TokenResult['chainId'];
    }, shouldRefetch?: boolean): Promise<void>;
    /**
     * Checks whether the account owns the collectible and stores the result in
     * `validTokens.erc721`, keyed by the collection and the id.
     *
     * `shouldRefetch` checks again for a collectible that already has a verdict,
     * which the UI asks for after a network problem.
     */
    updateCollectibleValidation(collectible: {
        address: TokenResult['address'];
        chainId: TokenResult['chainId'];
        tokenId: bigint;
    }, accountId: AccountId, shouldRefetch?: boolean): Promise<void>;
    initializePortfolioLibIfNeeded(accountId: AccountId, chainId: bigint, network: Network): Portfolio | null;
    getTokenBalancesOnBlock(accountId: AccountId, chainId: bigint, tokenAddrs: string[], blockTag: GetOptions['blockTag'], accountAddr?: string): Promise<[TokenError, TokenResult][]>;
    getTemporaryTokens(accountId: AccountId, chainId: bigint, additionalHint: string): Promise<boolean>;
    getTokenPrice(accountId: AccountId, chainId: bigint, address: string): Promise<number>;
    /**
     * Fetches portfolio asset hints and defi positions from the external API (Velcro)
     * and formats the response. If both hints and defi positions can be skipped, returns null data.
     * If the defi position update can be skipped, but hints have to be refetched it makes a request
     * to Velcro but passes a flag to signal to the server that it can returned cached defi data.
     */
    private getPortfolioFromApiDiscovery;
    protected updatePortfolioState(account: Account, network: Network, portfolioLib: Portfolio | null, portfolioProps: Partial<GetOptions> & {
        defiMaxDataAgeMs: number;
        hasKeys: boolean;
        maxDataAgeMs?: number;
        isManualUpdate?: boolean;
        bypassServerSideCache?: boolean;
    }): Promise<[boolean, FormattedPortfolioDiscoveryResponse | null]>;
    /**
     * Most defi positions are fetched from the external API per network, but there are some
     * "app" defi positions that have to be fetched separately, because they are not linked to a specific
     * network and have a slightly different structure (no addresses for assets).
     *
     * @example - Fetches Polymarket and Hyperliquid positions (among other)
     */
    protected updateDefiAppsState(account: Account, portfolioProps: Partial<GetOptions> & {
        defiMaxDataAgeMs: number;
        hasKeys: boolean;
        maxDataAgeMs?: number;
        isManualUpdate?: boolean;
        bypassServerSideCache?: boolean;
    }): Promise<void>;
    /**
     * Updates the portfolio of the passed account on the specified networks, or on all networks if none is specified.
     * If a simulation object is passed, it will be used to perform the update.
     *
     * @param accountId - the account for which the portfolio should be updated
     * @param networks - update only for these networks. If not passed, the portfolio will be updated for all networks in the wallet
     * @param simulation - simulation data. If not passed the portfolio will use the last passed simulation data
     * until it's overwritten by a new one or discarded using `discardSimulation(op)`
     * @param opts
     */
    updateSelectedAccount(accountId: AccountId, networks?: Network[], simulation?: {
        accountOps: {
            [key: string]: AccountOp[];
        };
        states?: {
            [chainId: string]: AccountOnchainState;
        };
    }, opts?: {
        maxDataAgeMs?: number;
        defiMaxDataAgeMs?: number;
        maxDataAgeMsUnused?: number;
        isManualUpdate?: boolean;
        bypassServerSideCache?: boolean;
        accountOpIdsToDiscard?: {
            [chainId: string]: string[];
        };
    }): Promise<void>;
    reportMissedPortfolioUpdateAfterUpdatedAccountOp(accountId: AccountId, updatedAccountsOps: SubmittedAccountOp[]): void;
    markSimulationAsBroadcasted(accountId: string, chainId: bigint): void;
    removeAccountData(address: Account['addr']): void;
    getAccountPortfolioState(accountAddr: string): AccountState;
    getIsStateWithOutdatedNetworks(accountAddr: string): boolean;
    getNetworksWithAssets(accountAddr: string): AccountAssetsState;
    /**
     * Always pass account ops that belong to the same account & network
     */
    simulateAccountOp(op: AccountOp): Promise<void>;
    updateNetworksWithDefiPositions(accountId: AccountId, accountState: AccountState, providers: RPCProviders): Promise<void>;
    getNetworksWithDefiPositions(accountAddr: string): NetworksWithPositions;
    addDefiSession(sessionId: string): void;
    removeDefiSession(sessionId: string): void;
    toJSON(): this & {
        customTokens: CustomToken[];
        tokenPreferences: TokenPreference[];
        scheduledUpdateChainIds: {
            [accountId: string]: bigint[];
        };
        hints: any;
        tokenDataCache: any;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=portfolio.d.ts.map