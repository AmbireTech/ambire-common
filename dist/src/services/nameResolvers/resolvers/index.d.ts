import { NameResolver } from '../types';
export * from './EnsCompatibleResolver';
export * from './EnsResolver';
export * from './NamoshiResolver';
export * from './GnsResolver';
/**
 * All name services the wallet resolves, in display-priority order (first match wins when an address
 * has names in several services). ENS is the fallback and the current primary.
 */
export declare const DEFAULT_RESOLVERS: NameResolver[];
//# sourceMappingURL=index.d.ts.map