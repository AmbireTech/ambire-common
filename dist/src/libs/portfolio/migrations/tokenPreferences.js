const inferStorageVersion = (tokenPreferences) => {
    if (tokenPreferences.some(({ symbol, decimals }) => !!symbol || !!decimals)) {
        return 1;
    }
    return 2;
};
const migrateHiddenTokens = (tokenPreferences) => {
    return tokenPreferences
        .filter(({ isHidden }) => isHidden)
        .map(({ address, networkId, isHidden }) => ({
        address,
        networkId,
        isHidden
    }));
};
const migrateCustomTokens = (tokenPreferences) => {
    return tokenPreferences
        .filter(({ standard }) => !!standard)
        .map(({ address, standard, networkId }) => ({
        address,
        standard,
        networkId
    }));
};
/**
 * Migrates legacy token preferences to token preferences and custom tokens
 * if necessary.
 */
const migrateTokenPreferences = (tokenPreferences, customTokens) => {
    const storageVersion = inferStorageVersion(tokenPreferences);
    // Migrate
    if (storageVersion === 1) {
        return {
            tokenPreferences: migrateHiddenTokens(tokenPreferences),
            customTokens: migrateCustomTokens(tokenPreferences),
            shouldUpdateStorage: true
        };
    }
    return {
        tokenPreferences,
        customTokens: customTokens || [],
        shouldUpdateStorage: false
    };
};
export { migrateTokenPreferences };
//# sourceMappingURL=tokenPreferences.js.map