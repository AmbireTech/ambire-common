import EventEmitter from '../../controllers/eventEmitter/eventEmitter';
export declare class Polling extends EventEmitter {
    state: {
        isError: boolean;
        error?: any;
    };
    defaultTimeout: number;
    allowableErrors: number[];
    startTime: number;
    constructor(allowableErrors?: number[]);
    exec<T>(fn: Function, params: any, cleanup: Function | null, shouldStop: Function | null, timeout?: number, pollingtime?: number): Promise<T | null>;
}
//# sourceMappingURL=polling.d.ts.map