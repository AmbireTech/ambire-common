import { BUNDLER } from '../../consts/bundlers';
import { Account } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { Bundler } from './bundler';
export declare class BundlerSwitcher {
    protected network: Network;
    protected bundler: Bundler;
    protected usedBundlers: BUNDLER[];
    /**
     * This service is stateless so we're allowing a method
     * to jump in and forbid updates if the controller state forbids them
     */
    hasControllerForbiddenUpdates: Function;
    constructor(network: Network, hasControllerForbiddenUpdates: Function);
    protected hasBundlers(): boolean | undefined;
    getBundler(): Bundler;
    canSwitch(acc: Account, bundlerError: Error | null): boolean;
    switch(): Bundler;
}
//# sourceMappingURL=bundlerSwitcher.d.ts.map