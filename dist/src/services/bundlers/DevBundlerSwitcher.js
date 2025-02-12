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
    constructor(network, getSignAccountOpStatus, noStateUpdateStatuses, usedBundlers) {
        super(network, getSignAccountOpStatus, noStateUpdateStatuses);
        this.bundler = new brokenBiconomyBroadcast_1.BrokenBiconomyBroadcast();
        if (usedBundlers)
            this.usedBundlers.push(...usedBundlers);
    }
}
exports.DevBundlerSwitcher = DevBundlerSwitcher;
//# sourceMappingURL=DevBundlerSwitcher.js.map