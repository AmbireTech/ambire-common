import { CustomToken, LegacyTokenPreference } from '../customToken';
/**
 * Migrates legacy token preferences to token preferences and custom tokens
 * if necessary.
 */
declare const migrateTokenPreferences: (tokenPreferences: LegacyTokenPreference[], customTokens?: CustomToken[]) => {
    tokenPreferences: {
        address: string;
        networkId: string;
        isHidden: boolean | undefined;
    }[];
    customTokens: {
        address: string;
        standard: "ERC20" | "ERC721";
        networkId: string;
    }[];
    shouldUpdateStorage: boolean;
} | {
    tokenPreferences: LegacyTokenPreference[];
    customTokens: CustomToken[];
    shouldUpdateStorage: boolean;
};
export { migrateTokenPreferences };
//# sourceMappingURL=tokenPreferences.d.ts.map