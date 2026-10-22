import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IStorageController } from '../../interfaces/storage';
import EventEmitter from '../eventEmitter/eventEmitter';
/**
 * Enables/disables per-controller debug logging at runtime. Logging settings
 * are persisted in storage and reloaded at startup.
 */
export declare class DebugController extends EventEmitter {
    #private;
    initialLoadPromise?: Promise<void>;
    constructor(storage: IStorageController, eventEmitterRegistry?: IEventEmitterRegistryController);
    /**
     * Full catalog of toggleable controllers with their on/off state (for the UI)
     */
    get namespaces(): {
        name: string;
        enabled: boolean;
    }[];
    setNamespaceEnabled(namespace: string, value: boolean): Promise<void>;
    destroy(): void;
    toJSON(): this & {
        namespaces: {
            name: string;
            enabled: boolean;
        }[];
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=debug.d.ts.map