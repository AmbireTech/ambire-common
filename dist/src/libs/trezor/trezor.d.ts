/**
 * Used to "translate" error codes returned by the Trezor device into a
 * human-readable messages. Although there is a message incoming from Trezor,
 * it's not self-explanatory and can be difficult for the end users to understand.
 */
export declare const getMessageFromTrezorErrorCode: (errorCode?: string, errorMsg?: string, context?: {
    isLedgerLiveSmartAccountForbiddenPath?: boolean;
    isHyperEvmForbiddenPath?: boolean;
}) => string;
/**
 * Used to "translate" errors thrown by the Trezor device into a human-readable
 * messages. Some of them are not self-explanatory and can be difficult for the
 * end users to understand.
 */
export declare const normalizeTrezorMessage: (error?: string) => string;
export declare const getTrezorErrorMessageFromPayload: (trezorUnsuccessfulPayload: any) => string;
//# sourceMappingURL=trezor.d.ts.map