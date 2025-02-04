import { BUNDLER } from '../../consts/bundlers';
import { Network } from '../../interfaces/network';
import { Bundler } from './bundler';
export declare class BundlerSwitcher {
    protected network: Network;
    protected bundler: Bundler;
    protected usedBundlers: BUNDLER[];
    protected getSignAccountOpStatus: Function;
    protected noStateUpdateStatuses: any[];
    constructor(network: Network, getSignAccountOpStatus: Function, noStateUpdateStatuses: any[]);
    protected hasBundlers(): boolean | undefined;
    getBundler(): Bundler;
    userHasCommitted(): boolean;
    canSwitch(bundlerError: Error | null): boolean;
    switch(): Bundler;
}
//# sourceMappingURL=bundlerSwitcher.d.ts.map