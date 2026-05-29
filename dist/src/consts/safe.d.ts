/**
 * A non-exclusive list of networks that Safe accounts are supported on.
 * We will use this list to know where to search for Safe accounts
 * and in accordance with the enabled user networks
 */
export declare const SAFE_NETWORKS: number[];
/**
 * SimulateTxAccessor addresses by Safe version.
 */
export declare const safeSimulateTxAccessor: {
    "v1.3.0": string;
    "v1.4.1": string;
    "v1.5.0": string;
};
export declare const execTransactionAbi: string[];
/**
 * In order to do batching, Safe needs an extra contract helper called multisend
 * This is the latest contract and it's Safe to use across versions
 */
export declare const multiSendAddr = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
/**
 * In order to do batching, Safe needs an extra contract helper called multisend
 * This is the latest contract and it's Safe to use across versions
 */
export declare const safeNullOwner = "0x0000000000000000000000000000000000000002";
export declare const allowedMulticallContracts: string[];
//# sourceMappingURL=safe.d.ts.map