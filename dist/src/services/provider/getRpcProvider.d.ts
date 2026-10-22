import { JsonRpcApiProviderOptions } from 'ethers';
import { Network as NetworkInterface } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { FetchJsonRpcProvider } from './fetchJsonRpcProvider';
import type { PublicClient } from 'viem';
declare const getRpcProvider: (rpcUrls: NetworkInterface["rpcUrls"], chainId?: bigint | number, selectedRpcUrl?: string, options?: JsonRpcApiProviderOptions) => FetchJsonRpcProvider;
declare const getProviderConnectionUrl: (network: NetworkInterface) => string;
declare const getViemClientForProvider: (provider: RPCProvider) => PublicClient;
export { getProviderConnectionUrl, getRpcProvider, getViemClientForProvider };
//# sourceMappingURL=getRpcProvider.d.ts.map