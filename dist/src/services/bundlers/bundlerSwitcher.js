/* eslint-disable class-methods-use-this */
import { getBundlerByName, getDefaultBundler } from './getBundler';
export class BundlerSwitcher {
    network;
    bundler;
    usedBundlers = [];
    // a function to retrieve the current sign account op state
    getSignAccountOpStatus;
    // TODO:
    // no typehints here as importing typehints from signAccountOp causes
    // a dependancy cicle. Types should be removed from signAccountOp in
    // a different file before proceeding to fix this
    noStateUpdateStatuses = [];
    constructor(network, getSignAccountOpStatus, noStateUpdateStatuses) {
        this.network = network;
        this.bundler = getDefaultBundler(network);
        this.usedBundlers.push(this.bundler.getName());
        this.getSignAccountOpStatus = getSignAccountOpStatus;
        this.noStateUpdateStatuses = noStateUpdateStatuses;
    }
    hasBundlers() {
        const bundlers = this.network.erc4337.bundlers;
        return bundlers && bundlers.length > 1;
    }
    getBundler() {
        return this.bundler;
    }
    userHasCommitted() {
        return this.noStateUpdateStatuses.includes(this.getSignAccountOpStatus());
    }
    canSwitch(bundlerError) {
        // don't switch the bundler if the account op is in a state of signing
        if (this.userHasCommitted())
            return false;
        if (!this.hasBundlers())
            return false;
        const availableBundlers = this.network.erc4337.bundlers.filter((bundler) => {
            return this.usedBundlers.indexOf(bundler) === -1;
        });
        if (availableBundlers.length === 0)
            return false;
        return (!bundlerError ||
            bundlerError.cause === 'biconomy: 400' ||
            bundlerError.cause === 'pimlico: 500');
    }
    switch() {
        if (!this.hasBundlers()) {
            throw new Error('no available bundlers to switch');
        }
        const availableBundlers = this.network.erc4337.bundlers.filter((bundler) => {
            return this.usedBundlers.indexOf(bundler) === -1;
        });
        this.bundler = getBundlerByName(availableBundlers[0]);
        this.usedBundlers.push(this.bundler.getName());
        return this.bundler;
    }
}
//# sourceMappingURL=bundlerSwitcher.js.map