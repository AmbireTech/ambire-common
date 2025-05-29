"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBundlerByName = getBundlerByName;
exports.getDefaultBundler = getDefaultBundler;
const bundlers_1 = require("../../consts/bundlers");
const biconomy_1 = require("./biconomy");
const pimlico_1 = require("./pimlico");
function getBundlerByName(bundlerName) {
    switch (bundlerName) {
        case bundlers_1.PIMLICO:
            return new pimlico_1.Pimlico();
        case bundlers_1.BICONOMY:
            return new biconomy_1.Biconomy();
        default:
            throw new Error('Bundler settings error');
    }
}
/**
 * Get the default bundler for the network without any extra logic.
 * If it's set, get it. If not, use pimlico
 */
function getDefaultBundler(network) {
    // hardcode biconomy for Sonic as it's not supported by pimlico
    if (network.chainId === 146n)
        return getBundlerByName(bundlers_1.BICONOMY);
    const bundlerName = network.erc4337.defaultBundler ? network.erc4337.defaultBundler : bundlers_1.PIMLICO;
    return getBundlerByName(bundlerName);
}
//# sourceMappingURL=getBundler.js.map