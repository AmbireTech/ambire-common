import { FromToken } from '../../interfaces/swapAndBridge';
export interface ConversionResult {
    tokenAmount: string;
    fiatAmount: string;
}
export declare const handleAmountConversion: (amount: string, amountFormatted: string, fromSelectedToken: FromToken | null, isInFiatMode: boolean, hardCodedCurrency: string) => ConversionResult;
//# sourceMappingURL=conversion.d.ts.map