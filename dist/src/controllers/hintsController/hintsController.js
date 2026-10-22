"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HintsController = void 0;
const tslib_1 = require("tslib");
const viem_1 = require("viem");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const defiPositions_1 = require("../../libs/defiPositions/defiPositions");
const assetMetadataStore_1 = require("../../libs/portfolio/assetMetadataStore");
const customToken_1 = require("../../libs/portfolio/customToken");
const helpers_1 = require("../../libs/portfolio/helpers");
const LEARNED_UNOWNED_LIMITS = {
    erc20s: 20,
    erc721s: 20
};
/**
 * How many tokens or collections keep stored metadata per network. Hints can include
 * plenty of spam the user never sees, so the oldest entries are dropped past this
 * point to prevent memory bloat.
 */
const ASSET_METADATA_LIMIT_PER_CHAIN = 1000;
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
class HintsController extends eventEmitter_1.default {
    #accounts;
    #keystore;
    customTokens = [];
    tokenPreferences = [];
    /**
     * @deprecated - see #learnedAssets
     */
    #previousHints = {
        fromExternalAPI: {},
        learnedTokens: {},
        learnedNfts: {}
    };
    #toBeLearnedAssets = {
        erc20s: {},
        erc721s: {}
    };
    #learnedAssets = { erc20s: {}, erc721s: {} };
    /**
     * Token symbols, names and decimals by chain id. Kept as maps so the portfolio
     * can look them up without rebuilding anything on every update, and in memory only,
     * so a restart reads everything in full again. Metadata does not depend on the
     * account, so all accounts share it.
     */
    #tokenMetadata;
    /**
     * Collection names and symbols by chain id, the NFT counterpart of #tokenMetadata.
     */
    #collectionMetadata;
    #storage;
    initialLoadPromise;
    constructor(storage, accounts, keystore) {
        super();
        this.#storage = storage;
        this.#accounts = accounts;
        this.#keystore = keystore;
        this.#tokenMetadata = new assetMetadataStore_1.AssetMetadataStore(ASSET_METADATA_LIMIT_PER_CHAIN);
        this.#collectionMetadata = new assetMetadataStore_1.AssetMetadataStore(ASSET_METADATA_LIMIT_PER_CHAIN);
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async #load() {
        this.tokenPreferences = await this.#storage.get('tokenPreferences', []);
        this.customTokens = await this.#storage.get('customTokens', []);
        this.#learnedAssets = await this.#storage.get('learnedAssets', this.#learnedAssets);
        this.#previousHints = await this.#storage.get('previousHints', {
            learnedNfts: {},
            learnedTokens: {},
            fromExternalAPI: {}
        });
        // Don't load fromExternalAPI hints in memory as they are no longer used
        this.#previousHints.fromExternalAPI = {};
    }
    /**
     * The token metadata held for a network, for the portfolio to pass to the library
     * so it can ask the chain for balances alone.
     */
    getKnownTokenMetadata(chainId) {
        return this.#tokenMetadata.getKnown(chainId);
    }
    /**
     * The collection counterpart of getKnownTokenMetadata.
     */
    getKnownCollectionMetadata(chainId) {
        return this.#collectionMetadata.getKnown(chainId);
    }
    /**
     * Keeps token metadata the portfolio library read from the chain. Entries replace
     * what is already held, which is how aged-out metadata gets refreshed. Returns
     * whether anything was kept.
     */
    learnTokenMetadata(chainId, entries) {
        return this.#tokenMetadata.learn(chainId, entries);
    }
    /**
     * The collection counterpart of learnTokenMetadata.
     */
    learnCollectionMetadata(chainId, entries) {
        return this.#collectionMetadata.learn(chainId, entries);
    }
    /**
     * Adds a custom token, unless it is already present.
     * Returns whether the custom tokens changed, so the caller can decide
     * whether a portfolio update is needed.
     */
    async addCustomToken(customToken) {
        await this.initialLoadPromise;
        // A collectible is added on its own, so the id is part of its identity
        const isTokenAlreadyAdded = this.customTokens.some((token) => (0, customToken_1.getAssetPreferenceId)(token) === (0, customToken_1.getAssetPreferenceId)(customToken));
        if (isTokenAlreadyAdded)
            return false;
        this.customTokens.push(customToken);
        this.emitUpdate();
        await this.#storage.set('customTokens', this.customTokens);
        return true;
    }
    /**
     * Stops requesting a collectible that was added by hand, so removing it takes
     * it out of the portfolio instead of leaving it to be rediscovered. Without an
     * id the whole collection was added, so all of it is forgotten.
     */
    async #forgetCollectible(collectible, accountAddr) {
        let checksummed;
        try {
            checksummed = (0, viem_1.getAddress)(collectible.address);
        }
        catch (e) {
            console.error('forgetCollectible: Error while normalizing nft address', e);
            return;
        }
        const toBeLearned = this.#toBeLearnedAssets.erc721s[collectible.chainId.toString()];
        const toBeLearnedIds = toBeLearned?.[checksummed];
        if (toBeLearned && toBeLearnedIds) {
            const remaining = typeof collectible.tokenId === 'bigint'
                ? toBeLearnedIds.filter((id) => id !== collectible.tokenId)
                : [];
            // An empty array requests the whole collection, so the entry goes instead
            if (remaining.length)
                toBeLearned[checksummed] = remaining;
            else
                delete toBeLearned[checksummed];
        }
        if (!accountAddr)
            return;
        const learnedNfts = this.#learnedAssets.erc721s[`${collectible.chainId}:${accountAddr}`];
        if (!learnedNfts)
            return;
        if (typeof collectible.tokenId === 'bigint') {
            delete learnedNfts[`${checksummed}:${collectible.tokenId}`];
        }
        else {
            Object.keys(learnedNfts)
                .filter((key) => key.startsWith(`${checksummed}:`))
                .forEach((key) => delete learnedNfts[key]);
        }
        await this.#storage.set('learnedAssets', this.#learnedAssets);
    }
    /**
     * Removes a custom token and, if a preference for it exists, its preference too.
     * Returns whether anything changed, so the caller can decide whether a portfolio
     * update is needed.
     */
    async removeCustomToken(customToken, accountAddr) {
        await this.initialLoadPromise;
        const isTokenBeingRemoved = (token) => (0, customToken_1.getAssetPreferenceId)(token) === (0, customToken_1.getAssetPreferenceId)(customToken);
        // The standard is needed by the preference, as it distinguishes a hidden
        // collection from a hidden token
        const removedTokenStandard = this.customTokens.find(isTokenBeingRemoved)?.standard;
        this.customTokens = this.customTokens.filter((token) => !isTokenBeingRemoved(token));
        if (removedTokenStandard === 'ERC721') {
            await this.#forgetCollectible(customToken, accountAddr);
        }
        const existingPreference = this.tokenPreferences.some((pref) => (0, customToken_1.getAssetPreferenceId)(pref) === (0, customToken_1.getAssetPreferenceId)(customToken));
        // Delete the custom token preference if it exists
        if (existingPreference) {
            this.#toggleTokenPreference({ ...customToken, standard: removedTokenStandard });
        }
        this.emitUpdate();
        await this.#storage.set('customTokens', this.customTokens);
        if (existingPreference) {
            await this.#storage.set('tokenPreferences', this.tokenPreferences);
        }
        return true;
    }
    /**
     * Toggles the hidden preference of a token.
     * Returns whether the preferences changed, so the caller can decide whether a
     * portfolio update is needed.
     */
    async toggleHideToken(tokenPreference) {
        await this.initialLoadPromise;
        this.#toggleTokenPreference(tokenPreference);
        this.emitUpdate();
        await this.#storage.set('tokenPreferences', this.tokenPreferences);
        return true;
    }
    #toggleTokenPreference(tokenPreference) {
        const preferenceId = (0, customToken_1.getAssetPreferenceId)(tokenPreference);
        const existingPreference = this.tokenPreferences.find((preference) => (0, customToken_1.getAssetPreferenceId)(preference) === preferenceId);
        // Push the token as hidden
        if (!existingPreference) {
            this.tokenPreferences.push({ ...tokenPreference, isHidden: true });
            // Remove the token preference if the user decides to show it again
        }
        else if (existingPreference.isHidden) {
            this.tokenPreferences = this.tokenPreferences.filter((preference) => (0, customToken_1.getAssetPreferenceId)(preference) !== preferenceId);
        }
        else {
            // Should happen only after migration
            existingPreference.isHidden = !existingPreference.isHidden;
        }
    }
    /**
     * Gets hints from all sources and formats them as expected
     * by the portfolio lib. These are all hints the portfolio uses,
     * except the external hints discovery request
     */
    getAllHints(accountId, chainId, networkDefiState, isManualUpdate, velcroHints) {
        const key = `${chainId}:${accountId}`;
        const isKeyNotMigrated = typeof this.#learnedAssets.erc20s[key] === 'undefined' ||
            typeof this.#learnedAssets.erc721s[key] === 'undefined';
        let learnedTokensHints = Object.keys(this.#learnedAssets.erc20s[key] || {});
        let learnedNftsHints = (0, helpers_1.mergeERC721s)([
            (0, helpers_1.learnedErc721sToHints)(Object.keys(this.#learnedAssets.erc721s[key] || {})),
            velcroHints?.erc721s || {}
        ]);
        // Add learned assets from all imported accounts on manual updates.
        // This is done to handle the case where an account sends a token to another imported account
        // We want the second account to see the token after a manual update
        // Also, the user has a higher chance of holding similar assets in different accounts
        if (isManualUpdate) {
            const importedAccountsLearned = this.#getImportedAccountsLearnedAssets(chainId, accountId);
            learnedTokensHints = importedAccountsLearned.learnedTokens;
            learnedNftsHints = importedAccountsLearned.learnedNfts;
        }
        // Check if the user key exists in the new learned tokens structure
        // Fallback to the old structure if not
        const { specialErc20Hints, specialErc721Hints } = (0, helpers_1.getSpecialHints)(chainId, this.customTokens, this.tokenPreferences, this.#toBeLearnedAssets);
        // Add the tokens to toBeLearned, but only for this call if the key is not migrated.
        // After the portfolio update all tokens with balance > 0 will be learned.
        if (isKeyNotMigrated) {
            const oldStructureLearnedNfts = this.#previousHints.learnedNfts?.[chainId.toString()] || {};
            const oldStructureLearnedTokens = this.#previousHints.learnedTokens?.[chainId.toString()] || {};
            Object.keys(oldStructureLearnedTokens).forEach((tokenAddr) => {
                specialErc20Hints.learn.push(tokenAddr);
            });
            Object.keys(oldStructureLearnedNfts).forEach((collectionAddr) => {
                const nftIds = oldStructureLearnedNfts[collectionAddr];
                if (!nftIds)
                    return;
                // A hint for the collection already exists
                if (specialErc721Hints.learn[collectionAddr]) {
                    specialErc721Hints.learn[collectionAddr].push(...nftIds);
                    return;
                }
                specialErc721Hints.learn[collectionAddr] = nftIds;
            });
        }
        const defiHints = (0, defiPositions_1.getAllAssetsAsHints)(networkDefiState);
        learnedTokensHints.push(...defiHints);
        this.debugLog('hints', `${chainId.toString()}: hints for ${accountId} (${!isManualUpdate ? 'not ' : ''}enhanced with those of other accounts)`, () => ({
            specialErc20Hints,
            specialErc721Hints,
            learnedTokensHints,
            learnedNftsHints
        }));
        return {
            specialErc20Hints,
            specialErc721Hints,
            additionalErc20Hints: [...learnedTokensHints, ...(velcroHints?.erc20s || [])],
            additionalErc721Hints: learnedNftsHints
        };
    }
    /**
     * Adds tokens to the hints of the portfolio with the intention of learning them.
     * The tokens are removed only if they are learned, which happens if their balance is
     * more than 0.
     */
    addTokensToBeLearned(tokenAddresses, chainId) {
        if (!tokenAddresses.length)
            return false;
        const chainIdString = chainId.toString();
        if (!this.#toBeLearnedAssets.erc20s[chainIdString])
            this.#toBeLearnedAssets.erc20s[chainIdString] = [];
        let networkToBeLearnedTokens = this.#toBeLearnedAssets.erc20s[chainIdString];
        const uniqueTokenAddresses = Array.from(new Set(tokenAddresses));
        const tokensToLearn = uniqueTokenAddresses.filter((address) => {
            if (address === viem_1.zeroAddress)
                return false;
            let normalizedAddress;
            try {
                normalizedAddress = (0, viem_1.getAddress)(address);
            }
            catch (e) {
                console.error('Error while normalizing token address', e);
            }
            if (!normalizedAddress)
                return false;
            // Don't add to be learned if the token is already a custom token or a token with a preference
            if (this.tokenPreferences.find(({ chainId: cId, address: addr }) => cId === chainId && addr === normalizedAddress) ||
                this.customTokens.find(({ chainId: cId, address: addr }) => cId === chainId && addr === normalizedAddress))
                return false;
            return !networkToBeLearnedTokens.includes(normalizedAddress);
        });
        if (!tokensToLearn.length)
            return false;
        networkToBeLearnedTokens = [...tokensToLearn, ...networkToBeLearnedTokens];
        this.debugLog('learning', `${chainId.toString()}: Added ERC-20 tokens to be learned`, tokensToLearn);
        this.#toBeLearnedAssets.erc20s[chainIdString] = networkToBeLearnedTokens;
        return true;
    }
    /**
     * Adds ERC-721 NFTs to the hints of the portfolio with the intention of learning them.
     * The nfts are removed only if they are learned, which happens if the user owns them
     */
    addErc721sToBeLearned(nftsData, accountAddr, chainId) {
        try {
            if (!nftsData || !nftsData.length)
                return false;
            const formattedNftsData = [];
            nftsData.forEach(([address, ids]) => {
                try {
                    const checksummed = (0, viem_1.getAddress)(address);
                    formattedNftsData.push([checksummed, ids]);
                }
                catch (e) {
                    console.error('addErc721sToBeLearned: Error while normalizing nft address', e);
                }
            });
            if (!formattedNftsData.length)
                return false;
            const key = `${chainId}:${accountAddr}`;
            if (!this.#learnedAssets.erc721s[key]) {
                this.#learnedAssets.erc721s[key] = {};
            }
            // Ensure toBeLearnedAssets is always defined
            const toBeLearnedAssets = this.#toBeLearnedAssets.erc721s[chainId.toString()] ??
                (this.#toBeLearnedAssets.erc721s[chainId.toString()] = {});
            const learnedErc721s = this.#learnedAssets.erc721s[key];
            let added = false;
            formattedNftsData.forEach(([collectionAddress, tokenIds]) => {
                // An enumerable NFT of this type already exists in either toBeLearned or learnedAssets
                // so we don't have to add it again
                if ((toBeLearnedAssets?.[collectionAddress] &&
                    !toBeLearnedAssets?.[collectionAddress].length) ||
                    (learnedErc721s && learnedErc721s[`${collectionAddress}:enumerable`]))
                    return;
                // Add an enumerable NFT toToBeLearned
                if (!tokenIds.length) {
                    toBeLearnedAssets[collectionAddress] = [];
                    return;
                }
                const ids = (0, helpers_1.erc721CollectionToLearnedAssetKeys)([collectionAddress, tokenIds]);
                ids.forEach((id) => {
                    const [, tokenIdString] = id.split(':');
                    if (!tokenIdString)
                        return;
                    const tokenId = BigInt(tokenIdString);
                    // An NFT with this id is already added to toBeLearned or learnedAssets
                    if (learnedErc721s[id] || toBeLearnedAssets[collectionAddress]?.includes(tokenId))
                        return;
                    if (!added) {
                        added = true;
                    }
                    if (!toBeLearnedAssets[collectionAddress]) {
                        toBeLearnedAssets[collectionAddress] = [];
                    }
                    toBeLearnedAssets[collectionAddress].push(tokenId);
                    this.debugLog('learning', `${chainId.toString()}: Added ERC-721 to be learned`, () => ({
                        collectionAddress,
                        tokenId: tokenId.toString(),
                        accountAddr
                    }));
                });
            });
            return added;
        }
        catch (e) {
            console.error('Error during addErc721sToBeLearned: ', e);
            return false;
        }
    }
    /**
     * toBeLearnedAssets contains arbitrary addresses that include:
     * - tokens and collectibles
     * - random smart contracts and addresses
     * That's why we need to clean it up by removing the addresses that the portfolio lib returned
     * an error for, as those are not NFTs/Tokens.
     */
    cleanupToBeLearnedAssets(chainId, tokenErrors, collectionErrors) {
        const chainIdString = chainId.toString();
        const toBeLearnedTokens = this.#toBeLearnedAssets.erc20s[chainIdString] || [];
        const toBeLearnedNfts = this.#toBeLearnedAssets.erc721s[chainIdString] || {};
        if (!tokenErrors?.length && !collectionErrors?.length)
            return;
        if (!toBeLearnedTokens.length && !Object.keys(toBeLearnedNfts).length)
            return;
        const erroredTokenAddresses = tokenErrors.map((e) => e.address);
        const erroredCollectionAddresses = collectionErrors?.map((e) => e.address) || [];
        this.#toBeLearnedAssets.erc20s[chainIdString] = toBeLearnedTokens.filter((address) => !erroredTokenAddresses.includes(address));
        this.#toBeLearnedAssets.erc721s[chainIdString] = Object.fromEntries(Object.entries(toBeLearnedNfts).filter(([collectionAddress]) => !erroredCollectionAddresses.includes(collectionAddress)));
    }
    /**
     * Learns the owned assets returned by the portfolio lib after a successful update.
     * Learns tokens/nfts with balance, finalizes the migration from `#previousHints`
     * for keys with no owned assets, and cleans up `toBeLearnedAssets` from the errored
     * (non token/nft) addresses the lib reported.
     *
     * !!NOTE: Must be called only after a successful portfolio update, because it relies
     * on the lib having returned only owned assets (see the notes on `learnTokens`/`learnNfts`).
     */
    async learnAssetsFromLibResult(key, chainId, accountAddr, networkResult) {
        await this.initialLoadPromise;
        const { erc20s, erc721s } = networkResult.toBeLearned || {};
        let shouldUpdateLearnedInStorage = false;
        if (erc20s?.length) {
            await this.learnTokens(erc20s, key, chainId);
        }
        else if (!this.#learnedAssets.erc20s[key]) {
            // Finalize the migration from #previousHints
            // If there are no erc20s to be learned and the key does not exist
            // in learnedAssets, we create an empty object to signal that
            // the migration has been finalized for this key
            // (the user has no erc20 tokens with balance in his portfolio)
            this.#learnedAssets.erc20s[key] = {};
            shouldUpdateLearnedInStorage = true;
        }
        if (erc721s && Object.keys(erc721s).length) {
            await this.learnNfts(Object.entries(erc721s).map(([collectionAddr, ids]) => [collectionAddr, ids]), accountAddr, chainId);
        }
        else if (!this.#learnedAssets.erc721s[key]) {
            // Finalize the migration from #previousHints
            // (same as erc20 hints, see the comment above)
            this.#learnedAssets.erc721s[key] = {};
            shouldUpdateLearnedInStorage = true;
        }
        this.cleanupToBeLearnedAssets(chainId, networkResult.tokenErrors, networkResult.collectionErrors);
        if (shouldUpdateLearnedInStorage) {
            await this.#storage.set('learnedAssets', this.#learnedAssets);
        }
    }
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
    async learnTokens(tokensWithBalance, key, chainId) {
        await this.initialLoadPromise;
        if (!tokensWithBalance)
            return false;
        if (!this.#learnedAssets.erc20s[key])
            this.#learnedAssets.erc20s[key] = {};
        const learnedTokens = this.#learnedAssets.erc20s[key];
        const now = Date.now();
        tokensWithBalance.forEach((address) => {
            if (address === viem_1.zeroAddress)
                return;
            learnedTokens[address] = now;
            const toBeLearnedAddress = this.#toBeLearnedAssets.erc20s[chainId.toString()];
            if (toBeLearnedAddress?.length) {
                // Remove the token from toBeLearnedTokens if it will be learned now
                this.#toBeLearnedAssets.erc20s[chainId.toString()] = toBeLearnedAddress.filter((addr) => addr !== address);
            }
        });
        // Keep a maximum of LEARNED_UNOWNED_LIMITS.erc20s tokens that are no longer owned by the user
        const noLongerOwnedTokens = Object.entries(learnedTokens)
            .filter(([, timestamp]) => timestamp !== now)
            // Sort by newest timestamp first
            .sort(([, timestampA], [, timestampB]) => timestampB - timestampA)
            .map(([address]) => address);
        this.debugLog('learning', `${chainId.toString()}: Tokens learned for ${key}`, () => ({
            learned: tokensWithBalance.filter((addr) => addr !== viem_1.zeroAddress),
            currentlyTracked: Object.keys(learnedTokens).length
        }));
        // Remove the oldest no longer owned tokens
        if (noLongerOwnedTokens.length > LEARNED_UNOWNED_LIMITS.erc20s) {
            const discarded = noLongerOwnedTokens.slice(LEARNED_UNOWNED_LIMITS.erc20s);
            discarded.forEach((address) => {
                delete learnedTokens[address];
            });
            this.debugLog('learning', `${chainId.toString()}: Discarded learned tokens for ${key}`, () => ({
                discarded,
                limit: LEARNED_UNOWNED_LIMITS.erc20s,
                noLongerOwned: noLongerOwnedTokens.length
            }));
        }
        await this.#storage.set('learnedAssets', this.#learnedAssets);
        return true;
    }
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
    async learnNfts(nftsData, accountAddr, chainId) {
        await this.initialLoadPromise;
        if (!nftsData?.length)
            return false;
        const key = `${chainId.toString()}:${accountAddr}`;
        if (!this.#learnedAssets.erc721s[key])
            this.#learnedAssets.erc721s[key] = {};
        if (!nftsData.length)
            return false;
        const now = Date.now();
        const learnedNfts = this.#learnedAssets.erc721s[key];
        nftsData.forEach((collection) => {
            const ids = (0, helpers_1.erc721CollectionToLearnedAssetKeys)(collection);
            ids.forEach((id) => {
                learnedNfts[id] = now;
            });
        });
        // Keep a maximum of LEARNED_UNOWNED_LIMITS.erc721s NFTs that are no longer owned by the user
        const noLongerOwnedNfts = Object.entries(learnedNfts)
            .filter(([, timestamp]) => {
            return timestamp !== now;
        })
            .map(([id]) => id);
        // Remove the oldest no longer owned NFTs
        if (noLongerOwnedNfts.length > LEARNED_UNOWNED_LIMITS.erc721s) {
            noLongerOwnedNfts.slice(LEARNED_UNOWNED_LIMITS.erc721s).forEach((id) => {
                delete learnedNfts[id];
            });
        }
        await this.#storage.set('learnedAssets', this.#learnedAssets);
        return true;
    }
    #getImportedAccountsLearnedAssets(chainId, accountAddr) {
        const providedKey = `${chainId}:${accountAddr}`;
        // Add the assets from the provided account first
        const learnedTokens = Object.keys(this.#learnedAssets.erc20s[providedKey] || {});
        let learnedNfts = (0, helpers_1.learnedErc721sToHints)(Object.keys(this.#learnedAssets.erc721s[providedKey] || {}));
        // Add the assets from all other imported accounts
        const importedAccounts = this.#accounts.accounts.filter((acc) => {
            return this.#keystore.getAccountKeys(acc).length > 0 && acc.addr !== accountAddr;
        });
        importedAccounts.forEach(({ addr }) => {
            const key = `${chainId}:${addr}`;
            const tokens = Object.keys(this.#learnedAssets.erc20s[key] || {});
            const nfts = Object.keys(this.#learnedAssets.erc721s[key] || {});
            // Don't dedupe here, it's already done in the portfolio library
            learnedTokens.push(...tokens);
            learnedNfts = (0, helpers_1.mergeERC721s)([learnedNfts, (0, helpers_1.learnedErc721sToHints)(nfts)]);
        });
        return {
            learnedTokens,
            learnedNfts
        };
    }
}
exports.HintsController = HintsController;
//# sourceMappingURL=hintsController.js.map