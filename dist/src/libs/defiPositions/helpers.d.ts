import { Price } from '../../interfaces/assets';
declare const getAssetValue: (amount: bigint, decimals: number, priceIn: Price[]) => number | undefined;
declare const isTokenPriceWithinHalfPercent: (price1: number, price2: number) => boolean;
declare const getProviderId: (providerName: string) => string;
export { getAssetValue, getProviderId, isTokenPriceWithinHalfPercent };
//# sourceMappingURL=helpers.d.ts.map