"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultColibriProverUrls = exports.isColibriProviderAvailable = exports.COLIBRI_PROVER_URLS_BY_CHAIN_ID = void 0;
exports.COLIBRI_PROVER_URLS_BY_CHAIN_ID = {
    '1': [
        'https://mainnet.colibri-proof.tech',
        'https://mainnet-prover.incubed.net',
        'https://mainnet.colibri.link'
    ],
    '11155111': ['https://sepolia.colibri-proof.tech'],
    '100': [
        'https://gnosis.colibri-proof.tech',
        'https://gnosis-prover.incubed.net',
        'https://gnosis.colibri.link'
    ]
};
const isColibriProviderAvailable = (chainId) => {
    return !!exports.COLIBRI_PROVER_URLS_BY_CHAIN_ID[chainId.toString()]?.length;
};
exports.isColibriProviderAvailable = isColibriProviderAvailable;
const getDefaultColibriProverUrls = (chainId) => {
    const urls = exports.COLIBRI_PROVER_URLS_BY_CHAIN_ID[chainId.toString()];
    return urls ? [...urls] : [];
};
exports.getDefaultColibriProverUrls = getDefaultColibriProverUrls;
//# sourceMappingURL=colibri.js.map