import { JsonRpcProvider } from 'ethers';
import { Network as NetworkInterface } from '../../interfaces/network';
interface ProviderOptions {
    batchMaxCount: number;
}
declare const getRpcProvider: (rpcUrls: NetworkInterface['rpcUrls'], chainId?: bigint | number, selectedRpcUrl?: string, options?: ProviderOptions) => JsonRpcProvider;
export { getRpcProvider };
//# sourceMappingURL=getRpcProvider.d.ts.map