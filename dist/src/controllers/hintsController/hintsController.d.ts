import EventEmitter from '../eventEmitter/eventEmitter';
import { AccountId, IAccountsController } from '../../interfaces/account';
import { IKeystoreController } from '../../interfaces/keystore';
import { Network } from '../../interfaces/network';
import { IStorageController } from '../../interfaces/storage';
import { CustomToken, TokenPreference } from '../../libs/portfolio/customToken';
import { CollectionMetadataEntry, GetOptions, Hints, KnownCollectionMetadata, KnownTokenMetadata, PortfolioNetworkResult, TokenMetadataEntry } from '../../libs/portfolio/interfaces';
/**
 * The hints controller owns all the "hints" the portfolio uses to discover which
 * tokens and NFTs an account holds, together with their storage. It is a
 * sub-controller of the PortfolioController: the portfolio decides when hints are
 * read/learned and re-exposes this controller's public state (customTokens,
 * tokenPreferences).
 *
 * Short glossary:
 * - Hints - list of token and NFT addresses that are likely to be owned by the user.
 * - Learned assets - assets the user has been seen owning (balance > 0), kept per
 * account+network (keyed by `${chainId}:${accountAddr}`) with the timestamp of when
 * they were last owned. This keeps tracking assets that are no longer owned (up to
 * LEARNED_UNOWNED_LIMITS per type, discarding the oldest first).
 * - To be learned assets - arbitrary addresses added from sources like swapAndBridge,
 * activity or the humanizer that may become owned soon. They are promoted to learned
 * assets once seen with a balance > 0 and cleaned up when the portfolio library reports
 * them as errored (i.e. they are not real tokens/NFTs).
 * - Custom tokens - tokens the user manually added.
 * - Token preferences - per-token UI preferences (currently only whether it's hidden).
 * - Previous hints - legacy storage structure. Its learned tokens/NFTs are
 * migrated into learnedAssets lazily, the first time an account+network key is updated.
 *
 * Note: the external hints discovery request (Velcro) is made by the portfolio, not
 * here; its result is passed into getAllHints as `velcroHints`.
 */
export declare class HintsController extends EventEmitter {
    #private;
    customTokens: CustomToken[];
    tokenPreferences: TokenPreference[];
    initialLoadPromise: Promise<void> | undefined;
    constructor(storage: IStorageController, accounts: IAccountsController, keystore: IKeystoreController);
    /**
     * The token metadata held for a network, for the portfolio to pass to the library
     * so it can ask the chain for balances alone.
     */
    getKnownTokenMetadata(chainId: bigint): KnownTokenMetadata;
    /**
     * The collection counterpart of getKnownTokenMetadata.
     */
    getKnownCollectionMetadata(chainId: bigint): KnownCollectionMetadata;
    /**
     * Keeps token metadata the portfolio library read from the chain. Entries replace
     * what is already held, which is how aged-out metadata gets refreshed. Returns
     * whether anything was kept.
     */
    learnTokenMetadata(chainId: bigint, entries: [string, TokenMetadataEntry][]): boolean;
    /**
     * The collection counterpart of learnTokenMetadata.
     */
    learnCollectionMetadata(chainId: bigint, entries: [string, CollectionMetadataEntry][]): boolean;
    /**
     * Adds a custom token, unless it is already present.
     * Returns whether the custom tokens changed, so the caller can decide
     * whether a portfolio update is needed.
     */
    addCustomToken(customToken: CustomToken): Promise<boolean>;
    /**
     * Removes a custom token and, if a preference for it exists, its preference too.
     * Returns whether anything changed, so the caller can decide whether a portfolio
     * update is needed.
     */
    removeCustomToken(customToken: Omit<CustomToken, 'standard'>, accountAddr?: string): Promise<boolean>;
    /**
     * Toggles the hidden preference of a token.
     * Returns whether the preferences changed, so the caller can decide whether a
     * portfolio update is needed.
     */
    toggleHideToken(tokenPreference: TokenPreference): Promise<boolean>;
    /**
     * Gets hints from all sources and formats them as expected
     * by the portfolio lib. These are all hints the portfolio uses,
     * except the external hints discovery request
     */
    getAllHints(accountId: AccountId, chainId: Network['chainId'], networkDefiState: PortfolioNetworkResult['defiPositions'] | undefined, isManualUpdate?: boolean, velcroHints?: Hints | null): Pick<Required<GetOptions>, 'specialErc20Hints' | 'specialErc721Hints' | 'additionalErc20Hints' | 'additionalErc721Hints'>;
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
     * Learns the owned assets returned by the portfolio lib after a successful update.
     * Learns tokens/nfts with balance, finalizes the migration from `#previousHints`
     * for keys with no owned assets, and cleans up `toBeLearnedAssets` from the errored
     * (non token/nft) addresses the lib reported.
     *
     * !!NOTE: Must be called only after a successful portfolio update, because it relies
     * on the lib having returned only owned assets (see the notes on `learnTokens`/`learnNfts`).
     */
    learnAssetsFromLibResult(key: `${string}:${string}`, chainId: bigint, accountAddr: string, networkResult: Pick<PortfolioNetworkResult, 'toBeLearned' | 'tokenErrors' | 'collectionErrors'>): Promise<void>;
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
    private learnTokens;
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
    private learnNfts;
}
//# sourceMappingURL=hintsController.d.ts.map