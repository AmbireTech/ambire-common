import { IContractNamesController } from '../../interfaces/contractNames';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { Fetch } from '../../interfaces/fetch';
import EventEmitter from '../eventEmitter/eventEmitter';
interface ContractNames {
    [address: string]: {
        address: string;
        name: string | null;
        isLoading: boolean;
        updatedAt?: number;
        retryAfter?: number;
        error?: string;
    };
}
export declare const PERSIST_NOT_FOUND_IN_MS: number;
export declare const PERSIST_FAILED_IN_MS: number;
export declare function isUnderstandableName(name: string): boolean;
/**
 * Contract Names controller - responsible for handling the lookup of address names.
 * Resolved names are saved in `contractNames` permanently, unless the lookup failed, then new
 * attempt will be made only after PERSIST_NOT_FOUND_IN_MS to avoid unnecessary lookups.
 */
export declare class ContractNamesController extends EventEmitter implements IContractNamesController {
    #private;
    constructor({ eventEmitterRegistry, fetch, debounceTime }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        fetch: Fetch;
        debounceTime?: number;
    });
    get contractNames(): ContractNames;
    get contractsPendingToBeFetched(): {
        address: string;
        chainId: bigint;
    }[];
    getName(_address: string, chainId: bigint): void;
    toJSON(): this & {
        contractNames: ContractNames;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=contractNames.d.ts.map