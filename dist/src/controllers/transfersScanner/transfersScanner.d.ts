import { IActivityController } from '../../interfaces/activity';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { INetworksController, Network } from '../../interfaces/network';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IProvidersController } from '../../interfaces/provider';
import EventEmitter from '../eventEmitter/eventEmitter';
type ScanLogsParams = {
    accAddr: string;
    chainId: Network['chainId'];
    fromBlock?: number | 'latest';
};
type ScanLogsResult = {
    nextFromBlock: number;
    txnIds: string[];
};
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
export declare class TransfersScannerController extends EventEmitter {
    #private;
    constructor({ activity, networks, portfolio, providers, eventEmitterRegistry }: {
        activity: IActivityController;
        networks: INetworksController;
        portfolio: IPortfolioController;
        providers: IProvidersController;
        eventEmitterRegistry?: IEventEmitterRegistryController;
    });
    scanLogs({ accAddr, chainId, fromBlock }: ScanLogsParams): Promise<ScanLogsResult | null>;
    startScanLogsLoop({ accAddr, chainId, fromBlock }: Omit<ScanLogsParams, 'toBlock'>): Promise<void>;
}
export {};
//# sourceMappingURL=transfersScanner.d.ts.map