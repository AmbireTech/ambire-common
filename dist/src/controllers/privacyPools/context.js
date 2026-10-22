"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChainProvider = exports.getChainConfig = exports.LockGeneration = void 0;
const privacyPools_1 = require("../../consts/privacyPools");
/** Bumped on every lock, so a sync that cannot be aborted does not write back wiped notes. */
class LockGeneration {
    #current = 0;
    get current() {
        return this.#current;
    }
    bump() {
        this.#current += 1;
    }
    isCurrent(generation) {
        return generation === this.#current;
    }
}
exports.LockGeneration = LockGeneration;
/** The Privacy Pools deployment on a chain. Throws on a chain without one. */
const getChainConfig = (chainId) => {
    const config = (0, privacyPools_1.getPrivacyPoolsChainConfig)(BigInt(chainId));
    if (!config)
        throw new Error(`privacyPools: unsupported chain ${chainId}`);
    return config;
};
exports.getChainConfig = getChainConfig;
/** The chain's provider from `ProvidersController`. Throws on a chain without one. */
const getChainProvider = (providers, chainId) => {
    const provider = providers.providers[chainId];
    if (!provider)
        throw new Error(`privacyPools: no provider for chain ${chainId}`);
    return provider;
};
exports.getChainProvider = getChainProvider;
//# sourceMappingURL=context.js.map