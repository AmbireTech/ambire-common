"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getColibriRpcProvider = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const colibri_stateless_1 = tslib_1.__importStar(require("@corpus-core/colibri-stateless"));
const colibri_1 = require("../../libs/networks/colibri");
const assertSupportedBlockTag = (method, params) => {
    if (!Array.isArray(params))
        return;
    if (method !== 'eth_call' && method !== 'eth_estimateGas')
        return;
    if (params[1] !== 'pending')
        return;
    throw new Error('Colibri verifier does not support pending block tag requests');
};
class ColibriRpcProvider extends ethers_1.JsonRpcProvider {
    #colibri;
    constructor(network, proverUrls, options) {
        super(network.selectedRpcUrl, ethers_1.Network.from(Number(network.chainId)), options);
        this.#colibri = new colibri_stateless_1.default({
            chainId: Number(network.chainId),
            rpcs: [network.selectedRpcUrl],
            prover: [...proverUrls],
            proofStrategy: colibri_stateless_1.Strategy.VerifiedOnly,
            prover_mode: 'remote',
            zk_proof: true
        });
    }
    send(method, params) {
        assertSupportedBlockTag(method, params);
        return this.#colibri.request({ method, params });
    }
    destroy() {
        this.#colibri.destroy();
        super.destroy();
    }
}
const getColibriRpcProvider = (network, options) => {
    const colibriProverUrls = (0, colibri_1.getDefaultColibriProverUrls)(network.chainId);
    if (!network.isColibriEnabled || !colibriProverUrls.length) {
        throw new Error('Colibri verifier is not configured for this network');
    }
    return new ColibriRpcProvider(network, colibriProverUrls, options);
};
exports.getColibriRpcProvider = getColibriRpcProvider;
//# sourceMappingURL=colibri.js.map