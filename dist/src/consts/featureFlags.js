"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USER_FEATURE_FLAGS = exports.featureFlagScopes = exports.defaultFeatureFlags = void 0;
exports.defaultFeatureFlags = {
    withTransactionManagerController: false,
    withEmailVaultController: true,
    withContinuousUpdatesController: true,
    testnetMode: false,
    tokenAndDefiAutoDiscovery: true,
    clearSigning: true,
    apiForFunctionSelectors: true,
    gasTank: true,
    networkConfig: true,
    ambireSmartAccounts: true,
    scamAndPhishingChecker: true,
    tokenPrices: true,
    erc4337: true,
    eip7702: true,
    keepEnsProfilesUpToDate: false,
    swapAndBridgeTokenInfo: true,
    ledgerSigningReports: false,
    walletStakingWithdrawalsLookup: true,
    // @TODO: Introduce a setting and flip to false
    namoshiDomains: true,
    gnsDomains: true
};
/**
 * Who controls each feature flag: 'user' flags are the privacy opt-outs the user toggles in
 * the settings (and syncs between products), 'internal' ones are set by each product itself.
 * Every flag must be listed, so a new one cannot be added without deciding its scope.
 */
exports.featureFlagScopes = {
    withTransactionManagerController: 'internal',
    withEmailVaultController: 'internal',
    withContinuousUpdatesController: 'internal',
    testnetMode: 'internal',
    tokenAndDefiAutoDiscovery: 'user',
    clearSigning: 'user',
    apiForFunctionSelectors: 'user',
    gasTank: 'user',
    networkConfig: 'user',
    ambireSmartAccounts: 'user',
    scamAndPhishingChecker: 'user',
    tokenPrices: 'user',
    erc4337: 'user',
    eip7702: 'user',
    keepEnsProfilesUpToDate: 'user',
    swapAndBridgeTokenInfo: 'user',
    ledgerSigningReports: 'user',
    walletStakingWithdrawalsLookup: 'user',
    namoshiDomains: 'internal',
    gnsDomains: 'internal'
};
/** The feature flags the user controls, see `featureFlagScopes` */
exports.USER_FEATURE_FLAGS = Object.keys(exports.featureFlagScopes).filter((flag) => exports.featureFlagScopes[flag] === 'user');
//# sourceMappingURL=featureFlags.js.map