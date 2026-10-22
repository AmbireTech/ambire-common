/**
 * Turns whatever the Privacy Pools SDK threw into an `Error`, keeping its message and the original
 * as `cause`. The SDK's Redux Toolkit thunks rethrow plain `{ name, message, stack }` objects.
 */
export declare const toPrivacyPoolsSdkError: (error: unknown, fallbackMessage: string) => Error;
//# sourceMappingURL=sdkError.d.ts.map