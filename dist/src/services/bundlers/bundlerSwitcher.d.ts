import { BUNDLER } from '../../consts/bundlers';
import { Network } from '../../interfaces/network';
import { BaseAccount } from '../../libs/account/BaseAccount';
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
    constructor(network: Network, hasControllerForbiddenUpdates: Function, opts?: {
        canDelegate: boolean;
        preferredBundler?: BUNDLER;
    });
    protected hasBundlers(): boolean;
    getBundler(): Bundler;
    canSwitch(baseAcc?: BaseAccount): boolean;
    switch(): Bundler;
    /**
     * Use this when you don't know which is the correct bundler for the
     * userOp and you are guessing. Otherwise, refrain from using it
     */
    forceSwitch(): Bundler;
    cleanUp(): void;
}
//# sourceMappingURL=bundlerSwitcher.d.ts.map