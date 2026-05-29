import { toBeHex } from 'ethers';
import { createPublicClient, defineChain, http } from 'viem';
import { CUSTOM } from '../../consts/bundlers';
import { Bundler } from './bundler';
export class CustomBundler extends Bundler {
    getUrl(network) {
        if (!network.customBundlerUrl)
            throw new Error('custom bundler not set');
        return network.customBundlerUrl;
    }
    async getGasPrice(network) {
        const chain = defineChain({
            id: Number(network.chainId),
            name: network.name,
            nativeCurrency: {
                name: network.nativeAssetId,
                symbol: network.nativeAssetSymbol,
                decimals: 18
            },
            rpcUrls: {
                default: {
                    http: [network.selectedRpcUrl]
                },
                public: {
                    http: [network.selectedRpcUrl]
                }
            },
            blockExplorers: {
                default: {
                    name: 'Block explorer',
                    url: network.explorerUrl || ''
                }
            }
        });
        const client = createPublicClient({
            chain,
            transport: http()
        });
        const data = await client.estimateFeesPerGas();
        return {
            slow: {
                maxFeePerGas: toBeHex(data.maxFeePerGas),
                maxPriorityFeePerGas: toBeHex(data.maxPriorityFeePerGas)
            },
            medium: {
                maxFeePerGas: toBeHex(data.maxFeePerGas),
                maxPriorityFeePerGas: toBeHex(data.maxPriorityFeePerGas)
            },
            fast: {
                maxFeePerGas: toBeHex(data.maxFeePerGas),
                maxPriorityFeePerGas: toBeHex(data.maxPriorityFeePerGas)
            },
            ape: {
                maxFeePerGas: toBeHex(data.maxFeePerGas),
                maxPriorityFeePerGas: toBeHex(data.maxPriorityFeePerGas)
            }
        };
    }
    async getStatus(network, userOpHash) {
        const provider = this.getProvider(network);
        const status = await provider.send('eth_getUserOperationReceipt', [userOpHash]).catch((e) => {
            console.log(`custom bundler with url ${this.getUrl(network)} failed to find the status of the user op`);
            console.log(e);
            return null;
        });
        if (!status || !status.receipt) {
            return {
                status: 'not_found'
            };
        }
        return {
            status: 'found',
            transactionHash: status.receipt.transactionHash
        };
    }
    getName() {
        return CUSTOM;
    }
    shouldReestimateBeforeBroadcast() {
        return true;
    }
}
//# sourceMappingURL=customBundler.js.map