import { fetchCaught } from '../fetch';
export const DEFAULT_DAPP_CATALOG_URL = 'https://dappcatalog.ambire.com/ambire-wallet-dapp-catalog.json';
export async function getWalletDappCatalog(fetch, catalogUrl) {
    const catalog = await fetchCaught(fetch, catalogUrl || DEFAULT_DAPP_CATALOG_URL);
    return catalog.body || [];
}
export * from './types';
//# sourceMappingURL=index.js.map