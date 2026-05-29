import { JsonRpcApiProviderOptions, JsonRpcProvider } from 'ethers';
import { PublicClient } from 'viem';
import { Network as NetworkInterface } from '../../interfaces/network';
declare const getRpcProvider: (rpcUrls: NetworkInterface["rpcUrls"], chainId?: bigint | number, selectedRpcUrl?: string, options?: JsonRpcApiProviderOptions) => JsonRpcProvider;
declare const getViemClientForProvider: (provider: JsonRpcProvider) => PublicClient;
export { getRpcProvider, getViemClientForProvider };
//# sourceMappingURL=getRpcProvider.d.ts.map