import { RPCProvider } from '../../interfaces/provider';
export declare function isCorrectAddress(address: string): boolean;
declare function resolveENSDomain(domain: string, bip44Item?: number[][]): Promise<string>;
declare function getBip44Items(coinTicker: string): any;
declare function reverseLookupEns(address: string, provider: RPCProvider): Promise<string | null>;
export { resolveENSDomain, getBip44Items, reverseLookupEns };
//# sourceMappingURL=ensDomains.d.ts.map