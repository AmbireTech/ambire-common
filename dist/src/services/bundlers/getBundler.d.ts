import { BUNDLER } from '../../consts/bundlers';
import { Network } from '../../interfaces/network';
import { Bundler } from './bundler';
export declare function getBundlerByName(bundlerName: BUNDLER): Bundler;
export declare function getDefaultBundlerName(network: Network, opts?: {
    canDelegate: boolean;
}): BUNDLER;
/**
 * Get the default bundler for the network without any extra logic.
 * If it's set, get it. If not, use pimlico
 */
export declare function getDefaultBundler(network: Network, opts?: {
    canDelegate: boolean;
}): Bundler;
export declare function getAvailableBundlerNames(network: Network): BUNDLER[];
/**
 * This method should be used in caution when you want to utilize all
 * available bundlers on a network as the same time to find and fix a problem
 */
export declare function getAvailableBunlders(network: Network): Bundler[];
//# sourceMappingURL=getBundler.d.ts.map