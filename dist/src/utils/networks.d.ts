import { ChainlistNetwork, Network } from '../interfaces/network';
declare const checkIsRpcUrlWorking: (rpcUrl: string) => Promise<boolean>;
declare const rollProviderUrlsAndFindWorking: (rpcUrls: string[], index: number) => Promise<string | null>;
declare const convertToAmbireNetworkFormat: (network: ChainlistNetwork) => Promise<Network>;
export { rollProviderUrlsAndFindWorking, checkIsRpcUrlWorking, convertToAmbireNetworkFormat };
//# sourceMappingURL=networks.d.ts.map