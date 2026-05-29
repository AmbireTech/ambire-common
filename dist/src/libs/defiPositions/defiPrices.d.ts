import { PositionsByProvider } from './types';
/**
 * Fetches the USD prices for the assets in the provided positions
 * using cena and updates the positions with the fetched prices and values.
 */
export declare function updatePositionsByProviderAssetPrices(fetch: Function, positionsByProvider: PositionsByProvider[], platformId?: string | null): Promise<(PositionsByProvider | {
    positions: {
        assets: import("./types").PositionAsset[];
        additionalData: {
            positionInUSD: number;
            positionIndex?: string;
            name?: string;
            APY?: number;
            collateralInUSD?: number;
            debtInUSD?: number;
            healthRate?: number | null;
            description?: string;
        };
        id: string;
    }[];
    positionInUSD: number;
    providerName: import("./types").ProviderName;
    chainId?: bigint;
    iconUrl: string;
    siteUrl: string;
    source: "debank" | "custom" | "mixed";
    type: "common" | "locked" | "lending" | "leveraged_farming" | "vesting" | "reward" | "options_seller" | "options_buyer" | "insurance_seller" | "insurance_buyer" | "perpetuals" | "nft_common" | "nft_lending" | "nft_fraction";
})[]>;
//# sourceMappingURL=defiPrices.d.ts.map