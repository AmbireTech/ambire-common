"use strict";
/* eslint-disable class-methods-use-this */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BundlerSwitcher = void 0;
const getBundler_1 = require("./getBundler");
class BundlerSwitcher {
    network;
    bundler;
    usedBundlers = [];
    /**
     * This service is stateless so we're allowing a method
     * to jump in and forbid updates if the controller state forbids them
     */
    hasControllerForbiddenUpdates;
    constructor(network, hasControllerForbiddenUpdates) {
        this.network = network;
        this.bundler = (0, getBundler_1.getDefaultBundler)(network);
        this.usedBundlers.push(this.bundler.getName());
        this.hasControllerForbiddenUpdates = hasControllerForbiddenUpdates;
    }
    hasBundlers() {
        const bundlers = this.network.erc4337.bundlers;
        return bundlers && bundlers.length > 1;
    }
    getBundler() {
        return this.bundler;
    }
    canSwitch(acc, bundlerError) {
        // no fallbacks for EOAs
        if (!acc.creation)
            return false;
        // don't switch the bundler if the account op is in a state of signing
        if (this.hasControllerForbiddenUpdates())
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
        this.bundler = (0, getBundler_1.getBundlerByName)(availableBundlers[0]);
        this.usedBundlers.push(this.bundler.getName());
        return this.bundler;
    }
}
exports.BundlerSwitcher = BundlerSwitcher;
//# sourceMappingURL=bundlerSwitcher.js.map