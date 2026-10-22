import type { EthereumProvider, TxLog } from '@kohaku-eth/provider';
/** The shape the SDK's data service asks a log source for. Not exported by the SDK. */
export type PrivacyPoolsLogsParams = {
    address: string;
    fromBlock: bigint;
    toBlock?: bigint;
    maxQuerySize?: bigint;
};
/**
 * Reads an address's logs over a block range, several windows at a time. The SDK's reader is
 * sequential; for the entrypoint's ~800 windows this cuts ten minutes to under two.
 *
 * Logs must stay in block order, as callers take the last event of a kind as the latest (e.g. the
 * ASP root). A window that fails all retries fails the whole read: a sync missing a
 * `PoolRegistered` would show a pool as nonexistent.
 */
export declare const createParallelLogSource: ({ provider }: {
    provider: EthereumProvider;
}) => (params: PrivacyPoolsLogsParams) => Promise<TxLog[]>;
//# sourceMappingURL=parallelLogSource.d.ts.map