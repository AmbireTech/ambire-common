/**
 * Thrown when the RPC returns the state of a block older than the one the portfolio
 * already displays, which would take the balances and the simulation backwards.
 */
export declare class StaleRpcBlockError extends Error {
    receivedBlockNumber: number;
    blocksBehind: number;
    simulationErrorMsg: string;
    constructor({ receivedBlockNumber, blocksBehind }: {
        receivedBlockNumber: number;
        blocksBehind: number;
    });
}
//# sourceMappingURL=StaleRpcBlockError.d.ts.map