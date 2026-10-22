"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaleRpcBlockError = void 0;
/**
 * Thrown when the RPC returns the state of a block older than the one the portfolio
 * already displays, which would take the balances and the simulation backwards.
 */
class StaleRpcBlockError extends Error {
    receivedBlockNumber;
    blocksBehind;
    simulationErrorMsg;
    constructor({ receivedBlockNumber, blocksBehind }) {
        super(`The RPC returned the state of block ${receivedBlockNumber}, which is ${blocksBehind} block(s) behind the state already displayed`);
        this.name = 'StaleRpcBlockError';
        this.receivedBlockNumber = receivedBlockNumber;
        this.blocksBehind = blocksBehind;
        this.simulationErrorMsg =
            "Network data is behind, so the transaction preview isn't available right now. It should recover shortly.";
    }
}
exports.StaleRpcBlockError = StaleRpcBlockError;
//# sourceMappingURL=StaleRpcBlockError.js.map