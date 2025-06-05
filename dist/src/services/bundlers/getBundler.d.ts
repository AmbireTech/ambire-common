import { BUNDLER } from '../../consts/bundlers';
import { Network } from '../../interfaces/network';
import { Bundler } from './bundler';
export declare function getBundlerByName(bundlerName: BUNDLER): Bundler;
/**
 * Get the default bundler for the network without any extra logic.
 * If it's set, get it. If not, use pimlico
 */
export declare function getDefaultBundler(network: Network): Bundler;
//# sourceMappingURL=getBundler.d.ts.map