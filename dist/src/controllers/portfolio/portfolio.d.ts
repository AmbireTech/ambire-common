import { Account, AccountId, AccountOnchainState, IAccountsController } from '../../interfaces/account';
import { IBannerController } from '../../interfaces/banner';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Fetch } from '../../interfaces/fetch';
import { IKeystoreController } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IProvidersController, RPCProviders } from '../../interfaces/provider';
import { IStorageController } from '../../interfaces/storage';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { NetworksWithPositions, PositionCountOnDisabledNetworks } from '../../libs/defiPositions/types';
import { Portfolio } from '../../libs/portfolio';
import { CustomToken, TokenPreference } from '../../libs/portfolio/customToken';
import { AccountAssetsState, AccountState, ExchangeInfoMap, FormattedPortfolioDiscoveryResponse, GetOptions, Hints, TemporaryTokens, TokenDataCache, TokenError, TokenResult } from '../../libs/portfolio/interfaces';
import EventEmitter from '../eventEmitter/eventEmitter';
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
export declare class PortfolioController extends EventEmitter implements IPortfolioController {
    #private;
    customTokens: CustomToken[];
    tokenPreferences: TokenPreference[];
    validTokens: any;
    temporaryTokens: TemporaryTokens;
    hasFundedHotAccount: boolean;
    protected batchedPortfolioDiscovery: Function;
    protected tokenDataCache: {
        [chainId: string]: TokenDataCache;
    };
    initialLoadPromise?: Promise<void>;
    defiSessionIds: string[];
    defiPositionsCountOnDisabledNetworks: PositionCountOnDisabledNetworks;
    exchangeState: {
        exchanges: ExchangeInfoMap | null;
        updatedAt: number | null;
        isLoading: boolean;
        retryCount: number;
    };
    constructor(storage: IStorageController, fetch: Fetch, providers: IProvidersController, networks: INetworksController, accounts: IAccountsController, keystore: IKeystoreController, relayerUrl: string, velcroUrl: string, banner: IBannerController, featureFlags: IFeatureFlagsController, eventEmitterRegistry?: IEventEmitterRegistryController);
    updateExchangeList(): Promise<void>;
    private fetchBlacklist;
    private get blacklist();
    addCustomToken(customToken: CustomToken, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    removeCustomToken(customToken: Omit<CustomToken, 'standard'>, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    toggleHideToken(tokenPreference: TokenPreference, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    removeNetworkData(chainId: bigint): void;
    /**
     * Removes simulation results from the portfolio state. This function is used when
     * all simulated account ops should be discarded for a network-account pair. It does
     * not update the portfolio but simply removes the simulation results from the state.
     *
     * If you instead need to remove a specific accountOp from the simulation results, use `discardSimulation`
     * (e.g., after an account op is broadcasted and confirmed)
     */
    overrideSimulationResults(accountOp: AccountOp): Promise<void>;
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
    initializePortfolioLibIfNeeded(accountId: AccountId, chainId: bigint, network: Network): Portfolio | null;
    getTokenBalancesOnBlock(accountId: AccountId, chainId: bigint, tokenAddrs: string[], blockTag: GetOptions['blockTag'], accountAddr?: string): Promise<[TokenError, TokenResult][]>;
    getTemporaryTokens(accountId: AccountId, chainId: bigint, additionalHint: string): Promise<boolean>;
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
    }): Promise<void>;
    /**
     * Gets hints from all sources and formats them as expected
     * by the portfolio lib. These are all hints the portfolio uses,
     * except the external hints discovery request
     */
    protected getAllHints(accountId: AccountId, chainId: Network['chainId'], isManualUpdate?: boolean, velcroHints?: Hints | null): Pick<Required<GetOptions>, 'specialErc20Hints' | 'specialErc721Hints' | 'additionalErc20Hints' | 'additionalErc721Hints'>;
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
    }): Promise<void>;
    reportMissedPortfolioUpdateAfterUpdatedAccountOp(accountId: AccountId, updatedAccountsOps: SubmittedAccountOp[]): void;
    markSimulationAsBroadcasted(accountId: string, chainId: bigint): void;
    /**
     * Adds tokens to the hints of the portfolio with the intention of learning them.
     * The tokens are removed only if they are learned, which happens if their balance is
     * more than 0.
     */
    addTokensToBeLearned(tokenAddresses: string[], chainId: bigint): boolean;
    /**
     * Adds ERC-721 NFTs to the hints of the portfolio with the intention of learning them.
     * The nfts are removed only if they are learned, which happens if the user owns them
     */
    addErc721sToBeLearned(nftsData: [string, bigint[]][] | undefined, accountAddr: string, chainId: bigint): boolean;
    /**
     * toBeLearnedAssets contains arbitrary addresses that include:
     * - tokens and collectibles
     * - random smart contracts and addresses
     * That's why we need to clean it up by removing the addresses that the portfolio lib returned
     * an error for, as those are not NFTs/Tokens.
     */
    private cleanupToBeLearnedAssets;
    /**
     * Used to learn new tokens (by adding them to `learnedAssets`) and updating
     * the timestamps of learned tokens.
     *
     * !!NOTE: This method must be called only by updateSelectedAccount with tokens
     * that have a `balance > 0`, because it updates the timestamp of tokens, that indicates
     * when the token was last seen with a balance > 0
     *
     * !!NOTE2: As this method is only called after a portfolio update, we are not
     * checksumming the passed tokens (because the lib always returns them checksummed).
     * If this ever changes, we need to checksum the addresses
     */
    protected learnTokens(tokensWithBalance: string[] | undefined, key: `${string}:${string}`, chainId: bigint): Promise<boolean>;
    /**
     * Used to learn new ERC-721 NFTs (by adding them to `learnedAssets`) and updating
     * the timestamps of learned collectibles.
     *
     * !!NOTE: This method must be called only by updateSelectedAccount with nfts
     * that the user owns, because it updates the timestamp of collectibles, that indicates
     * when the collectible was last seen with a balance > 0
     * !!NOTE2: As this method is only called after a portfolio update, we are not
     * checksumming the passed addresses (because the lib always returns them checksummed).
     * If this ever changes, we need to checksum them
     */
    protected learnNfts(nftsData: [string, bigint[]][] | undefined, accountAddr: string, chainId: bigint): Promise<boolean>;
    removeAccountData(address: Account['addr']): void;
    getAccountPortfolioState(accountAddr: string): AccountState;
    getIsStateWithOutdatedNetworks(accountAddr: string): boolean;
    getNetworksWithAssets(accountAddr: string): AccountAssetsState;
    simulateAccountOp(op: AccountOp): Promise<void>;
    updateNetworksWithDefiPositions(accountId: AccountId, accountState: AccountState, providers: RPCProviders): Promise<void>;
    getNetworksWithDefiPositions(accountAddr: string): NetworksWithPositions;
    addDefiSession(sessionId: string): void;
    removeDefiSession(sessionId: string): void;
    toJSON(): this & {
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=portfolio.d.ts.map