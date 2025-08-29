import { AmbireDappManifest } from './types';
export declare const DEFAULT_DAPP_CATALOG_URL = "https://dappcatalog.ambire.com/ambire-wallet-dapp-catalog.json";
export declare function getWalletDappCatalog(fetch: any, catalogUrl?: string): Promise<Array<AmbireDappManifest>>;
export * from './types';
export * from './dappCatalogUtils';
//# sourceMappingURL=index.d.ts.map