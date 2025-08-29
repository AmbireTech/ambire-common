"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getManifestFromDappUrl = exports.canOpenInIframe = exports.getNormalizedUrl = exports.getDappId = exports.chainIdToWalletNetworkId = void 0;
const fetch_1 = require("../fetch");
const types_1 = require("./types");
const networks_1 = require("consts/networks");
const chainIdToWalletNetworkId = (chainId) => {
    // TODO: v2
    return networks_1.networks.find((n) => n.chainId === BigInt(chainId))?.name || null;
};
exports.chainIdToWalletNetworkId = chainIdToWalletNetworkId;
const getDappId = (name) => {
    return `${name.toLowerCase().replace(/s/g, '_')}_${Date.now()}`;
};
exports.getDappId = getDappId;
const getNormalizedUrl = (inputStr) => {
    const url = inputStr.toLowerCase().split(/[?#]/)[0].replace('/manifest.json', '');
    return url;
};
exports.getNormalizedUrl = getNormalizedUrl;
const canOpenInIframe = async (fetch, url) => {
    const res = await (0, fetch_1.fetchCaught)(fetch, url, { method: 'HEAD' });
    // NOTE: looks like it enough to open it in iframe
    // It fails for cors and x-frame-options
    const canBeLoaded = !!res?.resp?.ok;
    return canBeLoaded;
};
exports.canOpenInIframe = canOpenInIframe;
const getManifestFromDappUrl = async (fetch, dAppUrl) => {
    const normalizedUrl = (0, exports.getNormalizedUrl)(dAppUrl);
    const url = normalizedUrl.replace(/\/$/, '');
    const manifestUrl = `${url}/manifest.json?${Date.now()}`;
    const { body } = await (0, fetch_1.fetchCaught)(fetch, manifestUrl);
    const hasManifest = !!body && body.name && (Array.isArray(body.icons) || body.iconPath);
    const isGnosisManifest = hasManifest && body.description && body.iconPath;
    const isWalletPlugin = hasManifest &&
        body.name &&
        body.description &&
        Array.isArray(body.networks) &&
        (isGnosisManifest ||
            (Array.isArray(body.web3Connectivity) &&
                body.web3Connectivity.includes(types_1.SupportedWeb3Connectivity.gnosis)));
    const manifest = hasManifest
        ? {
            url,
            name: body.name,
            description: body.description || body.name,
            iconUrl: body.iconUrl ||
                `${url}/${(body.iconPath || body.icons[0]?.src || '').replace(/^\//, '')}`,
            connectionType: isGnosisManifest ? 'gnosis' : 'walletconnect',
            networks: (body.networks || []).map(exports.chainIdToWalletNetworkId),
            isWalletPlugin,
            web3Connectivity: body.web3Connectivity,
            providedBy: body.providedBy
        }
        : null;
    return manifest;
};
exports.getManifestFromDappUrl = getManifestFromDappUrl;
//# sourceMappingURL=dappCatalogUtils.js.map