"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DevBundlerSwitcher = void 0;
const brokenBiconomyBroadcast_1 = require("./brokenBiconomyBroadcast");
const bundlerSwitcher_1 = require("./bundlerSwitcher");
/**
 * DANGER
 * This class is made only for testing purposes where we forcefully
 * set a broken bundler as the main one to test if fallback is working
 */
class DevBundlerSwitcher extends bundlerSwitcher_1.BundlerSwitcher {
    constructor(network, areUpdatesForbidden, removeAvailableBundlers = false) {
        super(network, areUpdatesForbidden);
        // push all available bundler as used so they are none available
        if (removeAvailableBundlers &&
            network.erc4337.bundlers &&
            network.erc4337.bundlers.length > 1) {
            const availableBundlers = network.erc4337.bundlers.filter((bundler) => bundler !== this.bundler.getName());
            this.usedBundlers.push(...availableBundlers);
        }
        this.bundler = new brokenBiconomyBroadcast_1.BrokenBiconomyBroadcast();
    }
}
exports.DevBundlerSwitcher = DevBundlerSwitcher;
//# sourceMappingURL=DevBundlerSwitcher.js.map