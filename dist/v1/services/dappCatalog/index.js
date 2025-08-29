"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DAPP_CATALOG_URL = void 0;
exports.getWalletDappCatalog = getWalletDappCatalog;
const tslib_1 = require("tslib");
const fetch_1 = require("../fetch");
exports.DEFAULT_DAPP_CATALOG_URL = 'https://dappcatalog.ambire.com/ambire-wallet-dapp-catalog.json';
async function getWalletDappCatalog(fetch, catalogUrl) {
    const catalog = await (0, fetch_1.fetchCaught)(fetch, catalogUrl || exports.DEFAULT_DAPP_CATALOG_URL);
    return catalog.body || [];
}
tslib_1.__exportStar(require("./types"), exports);
tslib_1.__exportStar(require("./dappCatalogUtils"), exports);
//# sourceMappingURL=index.js.map