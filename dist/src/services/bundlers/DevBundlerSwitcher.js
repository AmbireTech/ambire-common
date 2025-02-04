import { BrokenBiconomyBroadcast } from './brokenBiconomyBroadcast';
import { BundlerSwitcher } from './bundlerSwitcher';
/**
 * DANGER
 * This class is made only for testing purposes where we forcefully
 * set a broken bundler as the main one to test if fallback is working
 */
export class DevBundlerSwitcher extends BundlerSwitcher {
    constructor(network, getSignAccountOpStatus, noStateUpdateStatuses, usedBundlers) {
        super(network, getSignAccountOpStatus, noStateUpdateStatuses);
        this.bundler = new BrokenBiconomyBroadcast();
        if (usedBundlers)
            this.usedBundlers.push(...usedBundlers);
    }
}
//# sourceMappingURL=DevBundlerSwitcher.js.map