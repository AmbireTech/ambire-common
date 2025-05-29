import { Fetch } from '../../interfaces/fetch';
import { AccountState } from '../../libs/defiPositions/types';
import EventEmitter from '../eventEmitter/eventEmitter';
import { NetworksController } from '../networks/networks';
import { ProvidersController } from '../providers/providers';
import { SelectedAccountController } from '../selectedAccount/selectedAccount';
import { StorageController } from '../storage/storage';
export declare class DefiPositionsController extends EventEmitter {
    #private;
    constructor({ fetch, storage, selectedAccount, providers, networks }: {
        fetch: Fetch;
        storage: StorageController;
        selectedAccount: SelectedAccountController;
        providers: ProvidersController;
        networks: NetworksController;
    });
    updatePositions(opts?: {
        chainId?: bigint;
        maxDataAgeMs?: number;
    }): Promise<void>;
    removeNetworkData(chainId: bigint): void;
    getDefiPositionsState(accountAddr: string): AccountState;
    getNetworksWithPositions(accountAddr: string): import("../../libs/defiPositions/types").NetworksWithPositions;
    removeAccountData(accountAddr: string): void;
    toJSON(): this & {
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=defiPositions.d.ts.map