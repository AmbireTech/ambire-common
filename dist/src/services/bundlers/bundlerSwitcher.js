"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BundlerSwitcher = void 0;
const broadcast_1 = require("../../libs/broadcast/broadcast");
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
    constructor(network, hasControllerForbiddenUpdates, opts = { canDelegate: false }) {
        this.network = network;
        this.bundler =
            opts.preferredBundler && (0, getBundler_1.getAvailableBundlerNames)(network).includes(opts.preferredBundler)
                ? (0, getBundler_1.getBundlerByName)(opts.preferredBundler)
                : (0, getBundler_1.getDefaultBundler)(network, opts);
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
    canSwitch(baseAcc) {
        // don't switch the bundler if the account op is in a state of signing
        if (this.hasControllerForbiddenUpdates())
            return false;
        if (!this.hasBundlers())
            return false;
        const availableBundlers = (0, getBundler_1.getAvailableBunlders)(this.network).filter((bundler) => {
            return this.usedBundlers.indexOf(bundler.getName()) === -1;
        });
        if (availableBundlers.length === 0)
            return false;
        // only pimlico can do txn type 4 and if pimlico is
        // not working, we have nothing to fallback to
        if (baseAcc && baseAcc.shouldSignAuthorization(broadcast_1.BROADCAST_OPTIONS.byBundler))
            return false;
        return true;
    }
    switch() {
        if (!this.hasBundlers()) {
            throw new Error('no available bundlers to switch');
        }
        const availableBundlers = (0, getBundler_1.getAvailableBunlders)(this.network).filter((bundler) => {
            return this.usedBundlers.indexOf(bundler.getName()) === -1;
        });
        this.bundler = availableBundlers[0];
        this.usedBundlers.push(this.bundler.getName());
        return this.bundler;
    }
    /**
     * Use this when you don't know which is the correct bundler for the
     * userOp and you are guessing. Otherwise, refrain from using it
     */
    forceSwitch() {
        const availableBundlers = (0, getBundler_1.getAvailableBunlders)(this.network).filter((bundler) => {
            return this.usedBundlers.indexOf(bundler.getName()) === -1;
        });
        // reset on force so we always have a bundler available
        if (availableBundlers.length === 0) {
            this.usedBundlers = [];
            this.bundler = (0, getBundler_1.getAvailableBunlders)(this.network)[0];
            return this.bundler;
        }
        this.bundler = availableBundlers[0];
        this.usedBundlers.push(this.bundler.getName());
        return this.bundler;
    }
    cleanUp() {
        this.usedBundlers = [this.bundler.getName()];
    }
}
exports.BundlerSwitcher = BundlerSwitcher;
//# sourceMappingURL=bundlerSwitcher.js.map