export declare class ProviderError extends Error {
    isProviderInvictus?: boolean;
    providerUrl?: string;
    statusCode?: number;
    code?: string;
    constructor({ originalError, providerUrl }: {
        originalError: Error & {
            [key: string]: any;
        };
        providerUrl?: string;
    });
}
//# sourceMappingURL=ProviderError.d.ts.map