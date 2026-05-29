"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.modifyDappPropsIfNeeded = exports.sortDapps = exports.formatDappName = exports.getDomainFromUrl = exports.getDappIdFromUrl = void 0;
exports.getDappNameFromId = getDappNameFromId;
exports.unifyDefiLlamaDappUrl = unifyDefiLlamaDappUrl;
const tldts_1 = require("tldts");
const dapps_1 = require("../../consts/dapps/dapps");
const getDappIdFromUrl = (url) => {
    if (!url || url === 'internal')
        return 'internal';
    const predefinedDapp = dapps_1.predefinedDapps.find((d) => d.url === url);
    if (predefinedDapp)
        return predefinedDapp.id;
    try {
        const { hostname } = new URL(url);
        return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
    }
    catch {
        return url;
    }
};
exports.getDappIdFromUrl = getDappIdFromUrl;
const getDomainFromUrl = (url) => {
    const predefinedDapp = dapps_1.predefinedDapps.find((d) => d.url === url);
    if (predefinedDapp)
        return predefinedDapp.id;
    return (0, tldts_1.getDomain)(url);
};
exports.getDomainFromUrl = getDomainFromUrl;
const formatDappName = (name) => {
    if (name.toLowerCase().includes('uniswap'))
        return 'Uniswap';
    if (name.toLowerCase().includes('aave v3'))
        return 'AAVE';
    return name;
};
exports.formatDappName = formatDappName;
const sortDapps = (a, b) => {
    // 1. rewards.ambire.com always first
    if (a.id === 'rewards.ambire.com')
        return -1;
    if (b.id === 'rewards.ambire.com')
        return 1;
    // 2. Snapshot Ambire DAO always second
    if (a.id === 'snapshot.box/#/s:ambire.eth')
        return -1;
    if (b.id === 'snapshot.box/#/s:ambire.eth')
        return 1;
    // 3. Featured first, then by TVL
    const featuredAndTVL = Number(b.isFeatured) - Number(a.isFeatured) || Number(b.tvl) - Number(a.tvl);
    if (featuredAndTVL !== 0)
        return featuredAndTVL;
    // 4. Custom dapps last
    return Number(a.isCustom) - Number(b.isCustom);
};
exports.sortDapps = sortDapps;
const modifyDappPropsIfNeeded = (id, dappsMap, protocol, onModify) => {
    if (id === 'uniswap.org' || id === 'app.uniswap.org') {
        const uniswap = dappsMap.get(id);
        if (uniswap) {
            uniswap.id = 'app.uniswap.org';
            uniswap.icon = 'https://icons.llama.fi/uniswap-v4.png';
            uniswap.tvl = (uniswap.tvl || 0) + (protocol.tvl || 0);
            uniswap.description =
                'Swap, earn, and build on the leading decentralized crypto trading protocol.';
            onModify(uniswap);
        }
    }
    if (id === 'zora.co') {
        const zora = dappsMap.get(id);
        if (zora) {
            zora.name = 'Zora';
            zora.description =
                "The world's attention market. Trade any trending topic, idea, meme, or moment.";
            onModify(zora);
        }
    }
    if (id === 'app.ipor.io') {
        const fusionByIpor = dappsMap.get(id);
        if (fusionByIpor) {
            fusionByIpor.description =
                'Onchain vault infrastructure for institutional-grade yield. Explore existing strategies in the Fusion App and start earning.';
            onModify(fusionByIpor);
        }
    }
};
exports.modifyDappPropsIfNeeded = modifyDappPropsIfNeeded;
function getDappNameFromId(id) {
    try {
        return id
            .replace(/^www\./, '')
            .split('.')
            .map((part) => part
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' '))
            .join(' ');
    }
    catch {
        return 'Unknown Dapp';
    }
}
function unifyDefiLlamaDappUrl(url) {
    try {
        return new URL(url).origin;
    }
    catch {
        return url; // If it's not a valid URL, return as-is
    }
}
//# sourceMappingURL=helpers.js.map