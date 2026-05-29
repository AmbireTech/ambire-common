import EventEmitter from '../eventEmitter/eventEmitter';
export declare class EventEmitterRegistryController {
    #private;
    constructor(onUpdate: () => void);
    get size(): number;
    get(id: string): EventEmitter;
    values(): EventEmitter[];
    entries(): [string, EventEmitter][];
    set(id: string, ctrl: EventEmitter): void;
    delete(id: string): void;
    has(id: string): boolean;
    clear(): void;
    toJSON(): this & {
        size: number;
    };
}
//# sourceMappingURL=eventEmitterRegistry.d.ts.map