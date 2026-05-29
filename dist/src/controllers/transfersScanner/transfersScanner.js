import wait from '../../utils/wait';
import { withTimeout } from '../../utils/with-timeout';
import EventEmitter from '../eventEmitter/eventEmitter';
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SCAN_LOGS_ATTEMPTS = 15;
const SCAN_LOGS_RPC_TIMEOUT_MS = 10000;
const getScanLogsDelay = (attemptIndex) => {
    if (attemptIndex < 10)
        return 6000;
    if (attemptIndex < 13)
        return 12000;
    return 18000;
};
function topicAddress(address) {
    return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}
function getScanLoopKey(chainIdString, accAddr) {
    return `${chainIdString}:${accAddr.toLowerCase()}`;
}
function toError(error) {
    return error instanceof Error ? error : new Error(String(error));
}
function withScannerRpcTimeout(task, method) {
    return withTimeout(task, {
        timeoutMs: SCAN_LOGS_RPC_TIMEOUT_MS,
        message: `Transfer scanner ${method} RPC timed out after ${SCAN_LOGS_RPC_TIMEOUT_MS}ms`
    });
}
function getEarlierFromBlock(currentFromBlock, nextFromBlock) {
    if (typeof currentFromBlock === 'number' && typeof nextFromBlock === 'number') {
        return Math.min(currentFromBlock, nextFromBlock);
    }
    if (typeof currentFromBlock === 'number')
        return currentFromBlock;
    if (typeof nextFromBlock === 'number')
        return nextFromBlock;
    return 'latest';
}
/**
 * Transfers Scanner Controller
 * Scans ERC-20 Transfer logs for an account and records matching external transactions.
 *
 * For each account and network, the controller queries outgoing and incoming Transfer topics,
 * deduplicates the matching transaction hashes, fetches their receipts, and forwards them to
 * `ActivityController.addExternalAccountOp()` so they appear in account activity.
 *
 * After external transactions are recorded, it asks `PortfolioController.updateSelectedAccount()`
 * to refresh the affected network and learn newly discovered tokens from the receipts.
 *
 * Scan loops are tracked per account and network. Restarting a scan for the same pair keeps the
 * earliest pending cursor, so older unprocessed blocks are not skipped.
 *
 * The scan cursor advances only after logs and receipts for the scanned block range are processed.
 * RPC errors, timeouts, and missing receipts keep the current cursor so the next attempt can retry
 * the same block range.
 */
export class TransfersScannerController extends EventEmitter {
    #activity;
    #networks;
    #portfolio;
    #providers;
    #scanLoopId = 0;
    #activeScanLoopIdsByChainAndAccount = {};
    #activeScanLoopFromBlocksByChainAndAccount = {};
    constructor({ activity, networks, portfolio, providers, eventEmitterRegistry }) {
        super(eventEmitterRegistry);
        this.#activity = activity;
        this.#networks = networks;
        this.#portfolio = portfolio;
        this.#providers = providers;
    }
    async scanLogs({ accAddr, chainId, fromBlock = 'latest' }) {
        await this.#networks.initialLoadPromise;
        await this.#providers.initialLoadPromise;
        const chainIdString = chainId.toString();
        const provider = this.#providers.providers[chainIdString];
        const network = this.#networks.networks.find((n) => n.chainId === chainId);
        if (!provider || !network)
            return null;
        const toBlockNumber = await withScannerRpcTimeout(() => provider.getBlockNumber(), 'getBlockNumber').catch((e) => toError(e));
        if (toBlockNumber instanceof Error) {
            this.emitError({
                level: 'silent',
                message: `Failed to scan token transfer logs on network with id ${chainIdString}.`,
                error: toBlockNumber
            });
            return null;
        }
        const normalizedFromBlock = fromBlock === 'latest' ? toBlockNumber : fromBlock;
        // The next scan starts one block after the last scanned block. If the next
        // poll sees the same latest block, or a laggier RPC, the cursor can be ahead
        // of latest. In that case, skip getLogs and retry the same cursor later.
        if (normalizedFromBlock > toBlockNumber) {
            return { nextFromBlock: normalizedFromBlock, txnIds: [] };
        }
        const nextFromBlock = toBlockNumber + 1;
        const [logsOut, logsIn] = await Promise.all([
            withScannerRpcTimeout(() => provider.getLogs({
                fromBlock: normalizedFromBlock,
                toBlock: toBlockNumber,
                topics: [
                    ERC20_TRANSFER_TOPIC,
                    topicAddress(accAddr) // indexed from
                ]
            }), 'getLogs').catch((e) => toError(e)),
            withScannerRpcTimeout(() => provider.getLogs({
                fromBlock: normalizedFromBlock,
                toBlock: toBlockNumber,
                topics: [
                    ERC20_TRANSFER_TOPIC,
                    null,
                    topicAddress(accAddr) // indexed to
                ]
            }), 'getLogs').catch((e) => toError(e))
        ]);
        // if an error is encountered, retry from the same fromBlock
        const logsError = [logsOut, logsIn].find((logs) => logs instanceof Error);
        if (logsError) {
            this.emitError({
                level: 'silent',
                message: `Failed to scan token transfer logs on network with id ${chainIdString}.`,
                error: logsError
            });
            return null;
        }
        const logs = [...logsOut, ...logsIn];
        const txnIds = Array.from(new Set(logs.map((log) => log.transactionHash).filter((txnId) => !!txnId)));
        if (!txnIds.length)
            return { nextFromBlock, txnIds };
        const receipts = await Promise.all(txnIds.map((txnId) => withScannerRpcTimeout(() => provider.getTransactionReceipt(txnId), 'getTransactionReceipt')
            .then((receipt) => receipt || new Error(`Transaction receipt ${txnId} was not found`))
            .catch((e) => toError(e))));
        const receiptError = receipts.find((receipt) => receipt instanceof Error);
        if (receiptError) {
            this.emitError({
                level: 'silent',
                message: `Failed to scan token transfer receipts on network with id ${chainIdString}.`,
                error: receiptError
            });
            return null;
        }
        const successfulReceipts = receipts.filter((receipt) => !(receipt instanceof Error));
        await Promise.all(successfulReceipts.map((receipt) => this.#activity.addExternalAccountOp({
            accountAddr: accAddr,
            chainId,
            txnId: receipt.hash,
            receipt,
            shouldLearnTokens: true
        })));
        await this.#portfolio.updateSelectedAccount(accAddr, [network]);
        return { nextFromBlock, txnIds };
    }
    startScanLogsLoop({ accAddr, chainId, fromBlock = 'latest' }) {
        const chainIdString = chainId.toString();
        const scanLoopKey = getScanLoopKey(chainIdString, accAddr);
        const scanLoopFromBlock = getEarlierFromBlock(this.#activeScanLoopFromBlocksByChainAndAccount[scanLoopKey], fromBlock);
        this.#scanLoopId += 1;
        const scanLoopId = this.#scanLoopId;
        this.#activeScanLoopIdsByChainAndAccount[scanLoopKey] = scanLoopId;
        this.#activeScanLoopFromBlocksByChainAndAccount[scanLoopKey] = scanLoopFromBlock;
        return this.#runScanLogsLoop({ accAddr, chainId, fromBlock: scanLoopFromBlock, scanLoopId });
    }
    async #runScanLogsLoop({ accAddr, chainId, fromBlock, scanLoopId }) {
        const chainIdString = chainId.toString();
        const scanLoopKey = getScanLoopKey(chainIdString, accAddr);
        let nextFromBlock = fromBlock;
        for (let i = 0; i < SCAN_LOGS_ATTEMPTS; i++) {
            if (this.#activeScanLoopIdsByChainAndAccount[scanLoopKey] !== scanLoopId)
                return;
            try {
                const result = await this.scanLogs({
                    accAddr,
                    chainId,
                    fromBlock: nextFromBlock
                });
                if (result) {
                    nextFromBlock = result.nextFromBlock;
                    if (this.#activeScanLoopIdsByChainAndAccount[scanLoopKey] === scanLoopId) {
                        this.#activeScanLoopFromBlocksByChainAndAccount[scanLoopKey] = nextFromBlock;
                    }
                }
            }
            catch (error) {
                this.emitError({
                    level: 'silent',
                    message: `Failed to scan token transfer logs on network with id ${chainIdString}.`,
                    error: error instanceof Error ? error : new Error(String(error))
                });
            }
            if (i < SCAN_LOGS_ATTEMPTS - 1)
                await wait(getScanLogsDelay(i));
        }
        if (this.#activeScanLoopIdsByChainAndAccount[scanLoopKey] === scanLoopId) {
            this.#activeScanLoopIdsByChainAndAccount[scanLoopKey] = undefined;
            this.#activeScanLoopFromBlocksByChainAndAccount[scanLoopKey] = undefined;
        }
    }
}
//# sourceMappingURL=transfersScanner.js.map