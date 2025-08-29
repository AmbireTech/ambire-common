import { AmbireDappManifest } from './types';
export declare const chainIdToWalletNetworkId: (chainId: number) => string | null;
export declare const getDappId: (name: string) => string;
export declare const getNormalizedUrl: (inputStr: string) => string;
export declare const canOpenInIframe: (fetch: any, url: string) => Promise<boolean>;
export declare const getManifestFromDappUrl: (fetch: any, dAppUrl: string) => Promise<AmbireDappManifest | null>;
//# sourceMappingURL=dappCatalogUtils.d.ts.map