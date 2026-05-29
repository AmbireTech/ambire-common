import { Dapp, DefiLlamaProtocol } from '../../interfaces/dapp';
declare const getDappIdFromUrl: (url: string) => string;
declare const getDomainFromUrl: (url: string) => string;
declare const formatDappName: (name: string) => string;
declare const sortDapps: (a: Dapp, b: Dapp) => number;
declare const modifyDappPropsIfNeeded: (id: string, dappsMap: Map<string, Dapp>, protocol: DefiLlamaProtocol, onModify: (modifiedDapp: Dapp) => void) => void;
declare function getDappNameFromId(id: string): string;
declare function unifyDefiLlamaDappUrl(url: string): string;
export { getDappIdFromUrl, getDomainFromUrl, formatDappName, sortDapps, modifyDappPropsIfNeeded, getDappNameFromId, unifyDefiLlamaDappUrl };
//# sourceMappingURL=helpers.d.ts.map