export declare const DKIM_VALIDATOR_ADDR = "0x0000000000000000000000000000000000000000";
export declare const RECOVERY_DEFAULTS: {
    emailTo: string;
    acceptUnknownSelectors: boolean;
    waitUntilAcceptAdded: bigint;
    waitUntilAcceptRemoved: bigint;
    acceptEmptyDKIMSig: boolean;
    acceptEmptySecondSig: boolean;
    onlyOneSigTimelock: bigint;
};
export declare const knownSelectors: {
    'gmail.com': string;
};
export declare const frequentlyUsedSelectors: string[];
/**
 * Get the signerKey that goes as the address in privileges
 * and its accompanying priv hash for the email recovery
 *
 * @param validatorAddr string
 * @param validatorData BytesLike
 * @returns {Address, bytes32}
 */
export declare function getSignerKey(validatorAddr: string, validatorData: any): {
    signerKey: string;
    hash: string;
};
//# sourceMappingURL=recovery.d.ts.map