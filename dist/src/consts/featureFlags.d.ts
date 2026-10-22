export interface FeatureFlags {
    withTransactionManagerController: boolean;
    withEmailVaultController: boolean;
    withContinuousUpdatesController: boolean;
    testnetMode: boolean;
    tokenAndDefiAutoDiscovery: boolean;
    clearSigning: boolean;
    apiForFunctionSelectors: boolean;
    gasTank: boolean;
    networkConfig: boolean;
    ambireSmartAccounts: boolean;
    scamAndPhishingChecker: boolean;
    tokenPrices: boolean;
    /**
     * Allow the user to opt out of erc4337 which will automatically
     * disable paying gas in different tokens & gas tank.
     * For Ambire v2 accounts, it will also disable ETH payments (the user
     * will need an EOA account just like using a Safe)
     */
    erc4337: boolean;
    /**
     * Allow the user to opt out of upgrading EOA accounts through ERC-7702.
     * Existing onchain delegations are not revoked when this is disabled.
     */
    eip7702: boolean;
    /**
     * Off by default for privacy: passively bulk-resolving ENS/Namoshi for all
     * accounts links them together. When enabled, the wallet keeps every account's
     * ENS profile fresh in the background (the pre-privacy behaviour).
     */
    keepEnsProfilesUpToDate: boolean;
    /**
     * Fetch the price movement and the exchanges of the tokens in the Swap & Bridge
     * receive list. Requires sending their addresses to our price API, so the user
     * can opt out of it.
     */
    swapAndBridgeTokenInfo: boolean;
    /**
     * Off by default for privacy: Ledger's signing kit reports every transaction
     * and typed data signed with a Ledger device to Ledger (network, contract or
     * recipient address, device model/firmware, app versions and whether it was
     * blind-signed). When enabled, those reports are sent.
     */
    ledgerSigningReports: boolean;
    /**
     * Find the pending $WALLET withdrawals (unstakes) of the account through
     * Ambire's relayer logs. Requires sending the account address to the relayer,
     * so the user can opt out of it. When disabled, the withdrawals are found
     * only from the locally known transactions and from transaction ids that
     * the user enters.
     */
    walletStakingWithdrawalsLookup: boolean;
    /** Resolve Namoshi names (.btc, .citrea) on Citrea. */
    namoshiDomains: boolean;
    /** Resolve GNS names (.gwei) on Ethereum. */
    gnsDomains: boolean;
}
export declare const defaultFeatureFlags: FeatureFlags;
/**
 * Who controls each feature flag: 'user' flags are the privacy opt-outs the user toggles in
 * the settings (and syncs between products), 'internal' ones are set by each product itself.
 * Every flag must be listed, so a new one cannot be added without deciding its scope.
 */
export declare const featureFlagScopes: {
    readonly withTransactionManagerController: "internal";
    readonly withEmailVaultController: "internal";
    readonly withContinuousUpdatesController: "internal";
    readonly testnetMode: "internal";
    readonly tokenAndDefiAutoDiscovery: "user";
    readonly clearSigning: "user";
    readonly apiForFunctionSelectors: "user";
    readonly gasTank: "user";
    readonly networkConfig: "user";
    readonly ambireSmartAccounts: "user";
    readonly scamAndPhishingChecker: "user";
    readonly tokenPrices: "user";
    readonly erc4337: "user";
    readonly eip7702: "user";
    readonly keepEnsProfilesUpToDate: "user";
    readonly swapAndBridgeTokenInfo: "user";
    readonly ledgerSigningReports: "user";
    readonly walletStakingWithdrawalsLookup: "user";
    readonly namoshiDomains: "internal";
    readonly gnsDomains: "internal";
};
/** A feature flag the user controls, see `featureFlagScopes` */
export type UserFeatureFlag = {
    [K in keyof typeof featureFlagScopes]: (typeof featureFlagScopes)[K] extends 'user' ? K : never;
}[keyof typeof featureFlagScopes];
/** The feature flags the user controls, see `featureFlagScopes` */
export declare const USER_FEATURE_FLAGS: UserFeatureFlag[];
//# sourceMappingURL=featureFlags.d.ts.map