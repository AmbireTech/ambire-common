"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBundlerByName = getBundlerByName;
exports.getDefaultBundlerName = getDefaultBundlerName;
exports.getDefaultBundler = getDefaultBundler;
exports.getAvailableBundlerNames = getAvailableBundlerNames;
exports.getAvailableBunlders = getAvailableBunlders;
const bundlers_1 = require("../../consts/bundlers");
const biconomy_1 = require("./biconomy");
const candide_1 = require("./candide");
const customBundler_1 = require("./customBundler");
const etherspot_1 = require("./etherspot");
const gelato_1 = require("./gelato");
const pimlico_1 = require("./pimlico");
function getBundlerByName(bundlerName) {
    switch (bundlerName) {
        case bundlers_1.PIMLICO:
            return new pimlico_1.Pimlico();
        case bundlers_1.BICONOMY:
            return new biconomy_1.Biconomy();
        case bundlers_1.ETHERSPOT:
            return new etherspot_1.Etherspot();
        case bundlers_1.GELATO:
            return new gelato_1.Gelato();
        case bundlers_1.CANDIDE:
            return new candide_1.Candide();
        case bundlers_1.CUSTOM:
            return new customBundler_1.CustomBundler();
        default:
            throw new Error('Bundler settings error');
    }
}
function getDefaultBundlerName(network, opts = { canDelegate: false }) {
    // if the network has a custom bundler URL,
    // it should take precedence over anything else
    if (network.customBundlerUrl && network.customBundlerUrl.trim())
        return bundlers_1.CUSTOM;
    // use pimlico on all 7702 accounts that don't have a set delegation
    if (opts.canDelegate)
        return bundlers_1.PIMLICO;
    const availableBundlers = network.erc4337.bundlers
        ? network.erc4337.bundlers.filter((name) => bundlers_1.allBundlers.includes(name))
        : [];
    // if there are no availableBundlers declared for the network, proceed
    // to load the defaultBundler settings
    if (!availableBundlers.length || availableBundlers.length === 1) {
        return network.erc4337.defaultBundler && bundlers_1.allBundlers.includes(network.erc4337.defaultBundler)
            ? network.erc4337.defaultBundler
            : bundlers_1.PIMLICO;
    }
    // loterry system
    // pick one bundler between the available and return it
    const index = Math.floor(Math.random() * availableBundlers.length);
    return availableBundlers[index];
}
/**
 * Get the default bundler for the network without any extra logic.
 * If it's set, get it. If not, use pimlico
 */
function getDefaultBundler(network, opts = { canDelegate: false }) {
    return getBundlerByName(getDefaultBundlerName(network, opts));
}
function getAvailableBundlerNames(network) {
    if (network.customBundlerUrl && network.customBundlerUrl.trim())
        return [bundlers_1.CUSTOM];
    if (!network.erc4337.hasBundlerSupport)
        return [];
    if (!network.erc4337.bundlers)
        return [getDefaultBundlerName(network)];
    // the bundler may not be implemented in the codebase
    return network.erc4337.bundlers.filter((name) => bundlers_1.allBundlers.includes(name));
}
/**
 * This method should be used in caution when you want to utilize all
 * available bundlers on a network as the same time to find and fix a problem
 */
function getAvailableBunlders(network) {
    return getAvailableBundlerNames(network).map((bundler) => {
        return getBundlerByName(bundler);
    });
}
//# sourceMappingURL=getBundler.js.map