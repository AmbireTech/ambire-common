"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createParallelLogSource = void 0;
const ethers_1 = require("ethers");
/** Blocks per `eth_getLogs` call: the widest range the wallet's RPC accepts. */
const LOG_WINDOW_BLOCKS = 5000n;
/**
 * Windows in flight at once. Measured on `invictus.ambire.com`: 1 gives 1.6 req/s, 5 about 7, and
 * 32 only a third more with a 4x worse p95. 5 is past the knee and leaves the shared endpoint room.
 */
const LOG_WINDOW_CONCURRENCY = 5;
/** Retries per window before the whole read gives up. */
const MAX_ATTEMPTS = 4;
/** Doubles per attempt. Covers a rate limit or a dropped connection, not a refused query. */
const BASE_BACKOFF_MS = 500;
const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
/**
 * Reads an address's logs over a block range, several windows at a time. The SDK's reader is
 * sequential; for the entrypoint's ~800 windows this cuts ten minutes to under two.
 *
 * Logs must stay in block order, as callers take the last event of a kind as the latest (e.g. the
 * ASP root). A window that fails all retries fails the whole read: a sync missing a
 * `PoolRegistered` would show a pool as nonexistent.
 */
const createParallelLogSource = ({ provider }) => async (params) => {
    // The SDK types the address as any string, the provider as hex
    const { address } = params;
    if (!(0, ethers_1.isHexString)(address))
        throw new Error(`privacy pools: not a hex address (${address})`);
    const toBlock = params.toBlock ?? (await provider.getBlockNumber());
    const step = params.maxQuerySize ?? LOG_WINDOW_BLOCKS;
    const windows = [];
    for (let from = params.fromBlock; from <= toBlock; from += step) {
        const end = from + step - 1n;
        windows.push({ from, to: end < toBlock ? end : toBlock });
    }
    const readWindow = async ({ from, to }) => {
        for (let attempt = 1;; attempt += 1) {
            try {
                return await provider.getLogs({ address, fromBlock: from, toBlock: to });
            }
            catch (error) {
                if (attempt >= MAX_ATTEMPTS)
                    throw error;
                await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
            }
        }
    };
    // Slotted by window rather than appended, to keep block order whatever order answers arrive in
    const logsByWindow = new Array(windows.length);
    let nextWindow = 0;
    const worker = async () => {
        for (;;) {
            const index = nextWindow;
            nextWindow += 1;
            if (index >= windows.length)
                return;
            logsByWindow[index] = await readWindow(windows[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(LOG_WINDOW_CONCURRENCY, windows.length) }, worker));
    return logsByWindow.flat();
};
exports.createParallelLogSource = createParallelLogSource;
//# sourceMappingURL=parallelLogSource.js.map