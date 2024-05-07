"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geckoIdMapper = exports.geckoNetworkIdMapper = void 0;
// @TODO: can this be better/be eliminated? at worst, we'll just move it out of this file
// maps our own networkId to coingeckoPlatform
function geckoNetworkIdMapper(x) {
    return ({
        polygon: 'polygon-pos',
        arbitrum: 'arbitrum-one'
    }[x] || x);
}
exports.geckoNetworkIdMapper = geckoNetworkIdMapper;
// @TODO some form of a constants list
function geckoIdMapper(address, networkId) {
    if (address === '0x0000000000000000000000000000000000000000')
        return ({
            polygon: 'matic-network',
            'binance-smart-chain': 'binancecoin',
            avalanche: 'avalanche-2',
            arbitrum: 'ethereum',
            metis: 'metis-token',
            optimism: 'ethereum'
            // kucoin, gnosis, kc not added
        }[networkId] || networkId);
    if (address === '0x4da27a545c0c5B758a6BA100e3a049001de870f5')
        return 'aave';
    return null;
}
exports.geckoIdMapper = geckoIdMapper;
//# sourceMappingURL=coingecko.js.map