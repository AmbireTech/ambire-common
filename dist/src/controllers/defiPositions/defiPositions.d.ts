import { Fetch } from '../../interfaces/fetch';
import { NetworkId } from '../../interfaces/network';
import { Storage } from '../../interfaces/storage';
import { AccountState } from '../../libs/defiPositions/types';
import EventEmitter from '../eventEmitter/eventEmitter';
import { NetworksController } from '../networks/networks';
import { ProvidersController } from '../providers/providers';
import { SelectedAccountController } from '../selectedAccount/selectedAccount';
export declare class DefiPositionsController extends EventEmitter {
    #private;
    constructor({ fetch, storage, selectedAccount, providers, networks }: {
        fetch: Fetch;
        storage: Storage;
        selectedAccount: SelectedAccountController;
        providers: ProvidersController;
        networks: NetworksController;
    });
    updatePositions(networkId?: NetworkId): Promise<void>;
    removeNetworkData(networkId: NetworkId): void;
    getDefiPositionsState(accountAddr: string): AccountState;
    getNetworksWithPositions(accountAddr: string): import("../../libs/defiPositions/types").NetworksWithPositions;
    removeAccountData(accountAddr: string): void;
    toJSON(): this & {
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=defiPositions.d.ts.map