import { Session, SessionProp } from '../../classes/session';
import { Dapp } from '../../interfaces/dapp';
import { Messenger } from '../../interfaces/messenger';
import { Storage } from '../../interfaces/storage';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare class DappsController extends EventEmitter {
    #private;
    dappSessions: {
        [key: string]: Session;
    };
    initialLoadPromise: Promise<void>;
    constructor(_storage: Storage);
    get isReady(): boolean;
    get dapps(): Dapp[];
    set dapps(updatedDapps: Dapp[]);
    getOrCreateDappSession: (data: SessionProp) => Session;
    setSessionMessenger: (key: string, messenger: Messenger) => void;
    setSessionProp: (key: string, props: SessionProp) => void;
    deleteDappSession: (key: string) => void;
    broadcastDappSessionEvent: (ev: any, data?: any, origin?: string) => void;
    addDapp(dapp: Dapp): void;
    updateDapp(url: string, dapp: Partial<Dapp>): void;
    removeDapp(url: string): void;
    hasPermission(url: string): boolean;
    getDapp(url: string): Dapp | undefined;
    toJSON(): this & {
        dapps: Dapp[];
        isReady: boolean;
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=dapps.d.ts.map